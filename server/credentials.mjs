import {createHash} from 'node:crypto';
import {parseFeishuEnvironment} from './mydaily-client/environment.mjs';
const keys=['FEISHU_APP_ID','FEISHU_APP_SECRET','FEISHU_WIKI_ROOT_TOKEN','FEISHU_DRIVE_ROOT_TOKEN','FEISHU_WEB_BASE_URL','FEISHU_API_BASE_URL'];
export function createCredentialStore({environment=process.env}={}){
 let config;
 async function load(){
  if(config)return config;
  try{
   const source=keys.filter(key=>environment[key]).map(key=>key+'='+JSON.stringify(environment[key])).join('\n');
   const parsed=parseFeishuEnvironment(source);
   if(createHash('sha256').update(parsed.appId).digest('hex').slice(0,12)!=='1bbcfb5ee7f9')throw new Error();
   config=parsed;return config;
  }catch{throw Object.assign(new Error('飞书服务端配置不完整或应用不匹配，请检查 Render 环境变量。'),{safe:true});}
 }
 return {load,async status(){try{await load();return {configured:true,error:''};}catch(error){return {configured:false,error:error.message};}},async configure(){throw new Error('请在 Render 环境变量中配置飞书。');}};
}
