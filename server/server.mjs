import {createServer as httpServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createAuth} from './auth.mjs';
import {createJournalSigner} from './journal.mjs';
import {validateBook} from './feishu-ledger.mjs';
import {emptyBook} from './runtime/finance.mjs';

const problem=(message,status=400)=>Object.assign(new Error(message),{safe:true,status});
async function jsonBody(req,limit=48*1024*1024){
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??''))throw problem('请使用 JSON 请求。',415);
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>limit)throw problem('上传内容过大。',413);chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw problem('请求内容无效。');}
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2'};
export async function createWebServer({environment=process.env,service,staticDir}){
 const production=environment.NODE_ENV==='production';
 const originText=environment.APP_ORIGIN||environment.RENDER_EXTERNAL_URL;
 const origin=originText?new URL(originText).origin:null;
 if(production&&(!origin||!origin.startsWith('https://')))throw Error('请配置 HTTPS APP_ORIGIN，或使用 Render 提供的 RENDER_EXTERNAL_URL。');
 const accountId=createHash('sha256').update([environment.FEISHU_APP_ID,environment.FEISHU_WIKI_ROOT_TOKEN,environment.FEISHU_TABLE_URL].join('\n')).digest('hex').slice(0,24);
 const auth=await createAuth({password:environment.APP_PASSWORD,secret:environment.SESSION_SECRET,secure:production,accountId});
 const journal=createJournalSigner(environment.SESSION_SECRET,accountId);
 let cloud=null,lastRead=0,refreshing=null,writing=false;
 const target=environment.FEISHU_TABLE_URL||'';
 async function status(){const current=await service.status();return {...current,desktop:false,target:current.target||target,syncing:writing,source:'feishu'};}
 async function snapshot(){return {book:cloud??emptyBook(),ready:cloud!==null,sync:await status()};}
 async function refresh(force=false){
  if(writing)return;
  if(refreshing)return refreshing;
  if(!force&&Date.now()-lastRead<30000)return;
  lastRead=Date.now();refreshing=(async()=>{const result=await service.pull(cloud,{target});if(result.book){cloud=result.book;await service.accept(result.receipt);}})();
  try{await refreshing;}finally{refreshing=null;}
 }
 const server=httpServer(async(req,res)=>{
  const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"};
  if(production)headers['Strict-Transport-Security']='max-age=31536000';
  const send=(code,data,extra={})=>{if(res.headersSent)return;res.writeHead(code,{...headers,'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(data));};
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname==='/healthz'&&req.method==='GET')return send(200,{ok:true});
   const localOrigin=`http://${req.headers.host}`;
   if(origin?req.headers.host!==new URL(origin).host:!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(localOrigin))throw problem('请求域名无效。',403);
   if(!['GET','HEAD','POST'].includes(req.method))throw problem('不支持此请求。',405);
   if(req.method==='POST'&&(req.headers.origin!==(origin??localOrigin)||req.headers['sec-fetch-site']==='cross-site'))throw problem('请求来源无效，请从本站页面重试。',403);
   if(url.pathname==='/api/session'&&req.method==='GET')return send(200,{authenticated:auth.session(req),...(auth.session(req)?{accountId}:{})});
   if(url.pathname==='/api/login'&&req.method==='POST'){
    if(Number(req.headers['content-length']??0)>4096)throw problem('登录请求过大。',413);
    const result=await auth.login(await jsonBody(req,4096),req.socket.remoteAddress);
    return send(result.status,result.cookie?{authenticated:true,accountId}:{error:result.error},result.cookie?{'Set-Cookie':result.cookie}:{});
   }
   if(url.pathname==='/api/logout'&&req.method==='POST')return send(200,{authenticated:false},{'Set-Cookie':auth.clear()});
   if(url.pathname.startsWith('/api/')){
    if(!auth.session(req))return send(401,{error:'登录已过期，请重新登录。'});
    if(url.pathname==='/api/book'&&req.method==='GET'){
     let error;try{await refresh(url.searchParams.get('refresh')==='1');}catch(e){error=e.safe?e.message:'读取飞书失败，请稍后重试。';}
     const result=await snapshot();if(error)result.sync.error=error;
     return send(200,result);
    }
    if(req.method!=='POST')throw problem('接口不存在。',404);
    const input=await jsonBody(req);
    if(url.pathname==='/api/feishu/connect'){
     // One deployment is bound to one configured ledger. Browser input cannot switch it.
     await refresh(true);return send(200,await snapshot());
    }
    if(!['/api/feishu/prepare','/api/feishu/upload'].includes(url.pathname))throw problem('接口不存在。',404);
    if(writing)throw problem('已有上传正在进行，请稍后重试。',409);
    writing=true;
    try{
     if(refreshing)await refreshing.catch(()=>{});
     if(url.pathname.endsWith('/prepare')){
      const book=validateBook(input.book),baseBook=validateBook(input.baseBook);
      const prepared=await service.sync(book,target,{baseBook,prepareOnly:true});
      return send(200,{journal:journal.seal({recovery:prepared.prepared,book,baseBook})});
     }
     let saved;try{saved=journal.open(input.journal);}catch{throw problem('上传恢复记录校验失败，请保留当前浏览器缓存并检查 SESSION_SECRET 是否改变。');}
     const result=await service.sync(validateBook(saved.book),target,{baseBook:validateBook(saved.baseBook),recovery:saved.recovery});
     cloud=result.book;await service.accept(result.receipt);lastRead=Date.now();
     return send(200,await snapshot());
    }finally{writing=false;}
   }
   if(!['GET','HEAD'].includes(req.method))throw problem('页面不存在。',404);
   let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{throw problem('页面不存在。',404);}
   if(pathname.split('/').some(p=>p.startsWith('.')||p.includes('\\'))||pathname.includes('\0'))throw problem('页面不存在。',404);
   const relative=pathname==='/'?'index.html':pathname.slice(1),file=path.resolve(staticDir,relative);
   if(!file.startsWith(path.resolve(staticDir)+path.sep))throw problem('页面不存在。',404);
   try{if(!(await stat(file)).isFile())throw Error();const bytes=await readFile(file);res.writeHead(200,{...headers,'Content-Type':mime[path.extname(file)]??'application/octet-stream',...(relative.startsWith('assets/')?{'Cache-Control':'public, max-age=31536000, immutable'}:{})});res.end(req.method==='HEAD'?undefined:bytes);}catch{throw problem('页面不存在。',404);}
  }catch(error){send(error.status??(error.safe?400:500),{error:error.safe?error.message:'服务暂时不可用，请稍后重试。'});}
 });
 server.requestTimeout=180000;server.headersTimeout=15000;
 return server;
}
