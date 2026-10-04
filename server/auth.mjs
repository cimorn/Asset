import {createHmac,randomBytes,scrypt as derive,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(derive),lifetime=7*24*60*60;
export async function createAuth({username,password,secret,secure,accountId}){
 if(!username||typeof password!=='string'||password.length<12||typeof secret!=='string'||secret.length<32)throw new Error('请设置 APP_USERNAME、至少 12 位的 APP_PASSWORD 和至少 32 位的 SESSION_SECRET。');
 const salt=randomBytes(16),expected=await scrypt(password,salt,32);
 const sessionKey=createHmac('sha256',secret).update(password).digest();
 const mac=value=>createHmac('sha256',sessionKey).update(value).digest('base64url');
 const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
 const failures=new Map();let active=0;
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
   const now=Date.now();for(const [key,value]of failures)if(value.until<=now)failures.delete(key);
   const key=address||'unknown',prior=failures.get(key);
   if(active>=4||prior?.count>=6||failures.size>2000)return {status:429,error:'尝试次数较多，请稍后再试。'};
   failures.set(key,{count:(prior?.count??0)+1,until:prior?.until??now+15*60*1000});
   if(typeof input?.password!=='string'||input.password.length>512||typeof input?.username!=='string'||input.username.length>100)return {status:401,error:'用户名或密码不正确。'};
   active++;let matched=false;try{const actual=await scrypt(input.password,salt,32);matched=timingSafeEqual(actual,expected)&&equal(input.username,username);}finally{active--;}
   if(!matched)return {status:401,error:'用户名或密码不正确。'};
   failures.delete(key);const payload=Buffer.from(JSON.stringify({accountId,expires:now+lifetime*1000,nonce:randomBytes(16).toString('hex')})).toString('base64url');
   return {status:200,cookie:cookie(payload+'.'+mac(payload),lifetime)};
  },
 };
}
