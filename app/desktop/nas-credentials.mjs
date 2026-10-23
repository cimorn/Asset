import {readFile,writeFile,stat,mkdir,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseEnv} from 'node:util';
import {envPath} from './config-path.mjs';

const fail=message=>Object.assign(new Error(message),{safe:true});
export function normalizeNasUrl(raw,{allowLocalHttp=false}={}){
 let url;try{url=new URL(raw);}catch{throw fail('NAS_URL 必须是规范的 HTTPS 网址。');}
 const local=allowLocalHttp&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)&&!!url.port;
 if(typeof raw!=='string'||raw!==url.origin||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.hostname.endsWith('.')||(!local&&url.protocol!=='https:'))throw fail('NAS_URL 必须是规范的 HTTPS 来源网址，不能包含账号、路径或参数。');
 return url.origin;
}
export function createNasCredentialStore({root=path.dirname(envPath),allowLocalHttp=false}={}){
 const filename=path.join(root,'nas.env');let cached=null;
 function validate(bytes){
  let values;try{values=parseEnv(bytes.toString('utf8'));}catch{throw fail('NAS .env 格式无效，请重新选择。');}
  if(Object.keys(values).some(key=>!['NAS_URL','NAS_PASSWORD'].includes(key)))throw fail('请选择仅包含 NAS_URL 和 NAS_PASSWORD 的独立 NAS .env 文件。');
  const url=normalizeNasUrl(values.NAS_URL,{allowLocalHttp}),password=values.NAS_PASSWORD;
  if(typeof password!=='string'||!password.length||password.length>512||password.includes('\0'))throw fail('NAS_PASSWORD 缺失或无效，请选择 NAS .env 配置。');
  return {url,password};
 }
 async function bounded(target){const info=await stat(target);if(!info.isFile()||!info.size||info.size>131072)throw fail('NAS .env 文件大小或格式无效。');return readFile(target);}
 async function load(){
  let bytes;try{const info=await stat(filename),signature=[info.mtimeMs,info.ctimeMs,info.size].join('/');if(cached?.signature===signature)return cached.config;bytes=await bounded(filename);const config=validate(bytes);cached={signature,config};return config;}
  catch(error){cached=null;throw error.safe?error:fail('未找到有效的 NAS 配置，请选择含 NAS_URL 和 NAS_PASSWORD 的 .env 文件。');}finally{bytes?.fill(0);}
 }
 async function status(){try{await load();return {configured:true,error:''};}catch(error){return {configured:false,error:error.message};}}
 async function configure(target){
  if(typeof target!=='string'||!path.isAbsolute(target)||(path.extname(target).toLowerCase()!=='.env'&&path.basename(target).toLowerCase()!=='.env'))throw fail('请选择 NAS .env 配置文件。');
  let bytes,temp;try{bytes=await bounded(target);const config=validate(bytes);if(path.resolve(target)===path.resolve(filename)){cached=null;return;}
   // Store only NAS keys. A selected file can never replace the original personal .env.
   const selected=Buffer.from(bytes);
   try{await mkdir(root,{recursive:true});temp=filename+'.'+randomUUID()+'.tmp';await writeFile(temp,selected,{mode:0o600,flag:'wx'});const check=await bounded(temp);try{if(!check.equals(selected))throw fail('NAS 配置保存校验失败，原配置已保留。');}finally{check.fill(0);}await rename(temp,filename);temp=null;cached=null;}finally{selected.fill(0);}
  }catch(error){throw error.safe?error:fail('无法导入 NAS .env，请检查本机配置目录权限。');}finally{bytes?.fill(0);if(temp)await rm(temp,{force:true}).catch(()=>{});}
 }
 return {filename,load,status,configure};
}
