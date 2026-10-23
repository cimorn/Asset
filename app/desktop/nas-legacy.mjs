import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {validateBook} from './feishu-ledger.mjs';

// This reader has no network client and never writes, deletes or replays legacy files.
export function createLegacyReader({dataDir,configRoot,expectedFingerprint='1bbcfb5ee7f9'}){
 async function json(name){try{return JSON.parse(await readFile(path.join(dataDir,name),'utf8'));}catch{return null;}}
 async function exportState(){return {format:'asset-desktop-legacy-cache',exportedAt:new Date().toISOString(),cache:await json('feishu-cache.json'),rateDraft:await json('rate-draft.json'),pending:await json('feishu-upload.json')};}
 async function reader(){
  let bytes;try{
   const filename=path.join(configRoot,'.env'),info=await stat(filename);if(!info.isFile()||info.size>131072)return null;bytes=await readFile(filename);const env=parseEnv(bytes.toString('utf8'));
   const required=['FEISHU_APP_ID','FEISHU_APP_SECRET','FEISHU_WIKI_ROOT_TOKEN','FEISHU_DRIVE_ROOT_TOKEN','FEISHU_WEB_BASE_URL'];if(required.some(k=>typeof env[k]!=='string'||!env[k].trim()))return null;
   const appId=env.FEISHU_APP_ID.trim(),wiki=env.FEISHU_WIKI_ROOT_TOKEN.trim(),fingerprint=createHash('sha256').update(appId).digest('hex').slice(0,12);if(fingerprint!==expectedFingerprint)return null;
   const tenant=new URL(env.FEISHU_WEB_BASE_URL.trim()),api=env.FEISHU_API_BASE_URL?.trim()||'https://open.feishu.cn/open-apis';
   if(tenant.protocol!=='https:'||tenant.port||tenant.username||tenant.password||tenant.search||tenant.hash||tenant.pathname!=='/'||!/(?:^|\.)(?:feishu\.cn|larksuite\.com)$/.test(tenant.hostname)||!['https://open.feishu.cn/open-apis','https://open.larksuite.com/open-apis'].includes(api))return null;
   const connection=await json('feishu-connection.json');if(connection?.appFingerprint!==fingerprint||typeof connection.url!=='string')return null;const ledger=new URL(connection.url);
   if(ledger.origin!==tenant.origin||ledger.username||ledger.password||ledger.search||ledger.hash||!/^\/(wiki|base)\/[A-Za-z0-9]{10,80}$/.test(ledger.pathname)||connection.url!==ledger.href)return null;
   const saved=await json('feishu-cache.json');if(saved?.format!=='feishu-cache-v1'||saved.draft&&(!saved.draft.base||!saved.draft.book))return null;
   if(saved.draft){validateBook(saved.draft.base);validateBook(saved.draft.book);}
   const rateDraft=await json('rate-draft.json');if(rateDraft&&(!/^\d{4}-\d{2}-\d{2}$/.test(rateDraft.date)||!rateDraft.rates||typeof rateDraft.rates!=='object'||Array.isArray(rateDraft.rates)||Object.keys(rateDraft.rates).length>100||Object.entries(rateDraft.rates).some(([code,rate])=>! /^[A-Z]{3}$/.test(code)||typeof rate!=='string'||rate.length>40)))return null;
   return {accountId:createHash('sha256').update([appId,wiki,connection.url].join('\n')).digest('hex').slice(0,24),draft:saved.draft??null,rateDraft};
  }catch{return null;}finally{bytes?.fill(0);}
 }
 reader.export=exportState;return reader;
}
