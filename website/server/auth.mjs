import {createHmac,randomBytes,scrypt as derive,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(derive),lifetime=7*24*60*60;
export async function createAuth({password,secret,secure,accountId,clock=Date.now}){
 if(typeof password!=='string'||!password.length)throw new Error('请设置 APP_PASSWORD（登录密码不能为空，无最小长度要求）。');
 if(typeof secret!=='string'||secret.length<32)throw new Error('请保留 Render 自动生成的 SESSION_SECRET，或设置至少 32 位的会话密钥；它不是登录密码。');
 const salt=randomBytes(16),expected=await scrypt(password,salt,32);
 const sessionKey=createHmac('sha256',secret).update(password).digest();
 const mac=value=>createHmac('sha256',sessionKey).update(value).digest('base64url');
 const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
 // Use the socket peer, never caller-controlled forwarding headers. Behind a
 // reverse proxy these budgets are shared by clients of that proxy.
 const clients=new Map();let active=0,globalCount=0,globalUntil=0;
 function session(req){
  const value=(req.headers.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith('atlas_web_session='))?.slice(18);
  if(!value||value.length>1024)return false;
  const [payload,signature]=value.split('.');if(!signature||!equal(signature,mac(payload)))return false;
  try{const saved=JSON.parse(Buffer.from(payload,'base64url').toString());return saved.accountId===accountId&&Number.isFinite(saved.expires)&&saved.expires>Date.now();}catch{return false;}
 }
 function cookie(value,seconds){return `atlas_web_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${secure?'; Secure':''}`;}
 return {
  session,clear:()=>cookie('',0),
  async login(input,address){
   const now=clock();
   const blocked=until=>{const retryAfter=Math.max(1,Math.ceil((until-now)/1000));return {status:429,retryAfter,error:`登录尝试过于频繁，请在 ${retryAfter} 秒后重试。`};};
   for(const [key,value]of clients)if(!value.active&&value.failureUntil<=now&&value.attemptUntil<=now)clients.delete(key);
   if(globalUntil<=now){globalCount=0;globalUntil=now+60000;}
   const key=address||'unknown';let client=clients.get(key);
   if(client?.failureUntil<=now)client.failures=0;
   if(client?.attemptUntil<=now)client.attempts=0;
   if(client?.failures>=6)return blocked(client.failureUntil);
   if(client?.attempts>=10)return blocked(client.attemptUntil);
   if(globalCount>=60)return blocked(globalUntil);
   if(active>=4)return blocked(now+1000);
   if(!client){
    if(clients.size>=2000)return blocked(now+60000);
    client={failures:0,failureUntil:0,attempts:0,attemptUntil:0,active:0};clients.set(key,client);
   }
   if(client.failureUntil<=now)client.failureUntil=now+15*60000;
   if(client.attemptUntil<=now)client.attemptUntil=now+60000;
   // Reserve before awaiting the body or scrypt, so parallel and malformed
   // submissions cannot bypass either the request or failure budgets.
   client.attempts++;client.failures++;client.active++;globalCount++;active++;
   let matched=false;
   try{
    const body=typeof input==='function'?await input():input;
    if(typeof body?.password!=='string'||body.password.length>512)return {status:401,error:'密码不正确。'};
    const actual=await scrypt(body.password,salt,32);matched=timingSafeEqual(actual,expected);
    if(!matched)return {status:401,error:'密码不正确。'};
    const payload=Buffer.from(JSON.stringify({accountId,expires:clock()+lifetime*1000,nonce:randomBytes(16).toString('hex')})).toString('base64url');
    return {status:200,cookie:cookie(payload+'.'+mac(payload),lifetime)};
   }finally{active--;client.active--;if(matched)client.failures=Math.max(0,client.failures-1);}
  },
 };
}
