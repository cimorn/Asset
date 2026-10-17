import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCredentialStore} from '../server/credentials.mjs';
import {createFeishuService} from '../server/feishu.mjs';
import {digest,checkedInputs} from '../server/mongo-ledger.mjs';
import {FeishuClient} from '../server/mydaily-client/feishu-client.mjs';
const fail=message=>Object.assign(new Error(message),{safe:true});
const readOnlyClients=new WeakMap();
export function readOnlyFeishuClient(client){
 if(readOnlyClients.has(client))return readOnlyClients.get(client);
 const request=client.request.bind(client);
 const guardedRequest=async(endpoint,options={})=>{
  if((options.method??'GET')!=='GET')throw fail('迁移工具禁止修改飞书。');
  return request(endpoint,{...options,method:'GET'});
 };
 // Helpers retain the real class receiver for private fields. Their this.request
 // is immutable and guarded too, so an indirect write cannot bypass the facade.
 Object.defineProperty(client,'request',{value:guardedRequest,writable:false,configurable:false});
 const facade=Object.create(null);
 for(let owner=client;owner&&owner!==Object.prototype;owner=Object.getPrototypeOf(owner)){
  for(const key of Reflect.ownKeys(owner)){
   if(key==='constructor'||Object.hasOwn(facade,key))continue;
   const value=Object.getOwnPropertyDescriptor(owner,key)?.value;
   if(typeof value==='function')Object.defineProperty(facade,key,{value:value.bind(client),enumerable:true});
  }
 }
 Object.freeze(facade);readOnlyClients.set(client,facade);return facade;
}
export function verifyReadOnlySnapshot(result){
 if(!result?.book||!result.receipt?.hash||result.receipt.hash!==digest(result.book)||result.status?.warning||result.status?.error||result.receipt.warning||result.deferred)throw fail('飞书未返回可验证的完整正式账本，导出已停止；请等旧上传完成后重新读取。');
 return result.book;
}
export async function exportFeishuReadOnly({environment=process.env,output,clientFactory}={}){
 if(environment.NODE_ENV==='production'||environment.MONGODB_URI)throw fail('只读飞书导出仅可在本机独立环境运行，不能带入 NAS 运行配置。');
 if(!output)throw fail('请指定本机私密目录的 --output 文件。');
 const credentialStore=createCredentialStore({environment});
 const factory=async()=>{
  const connected=clientFactory?await clientFactory():{config:await credentialStore.load()};
  const client=connected.client??new FeishuClient({appId:connected.config.appId,appSecret:connected.config.appSecret,apiBaseUrl:connected.config.apiBaseUrl,fetchImpl:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(20000)})});
  return {client:readOnlyFeishuClient(client),config:connected.config};
 };
 const service=createFeishuService('',{credentialStore,clientFactory:factory,volatile:true});
 const result=await service.pull(undefined,{target:environment.FEISHU_TABLE_URL||''});verifyReadOnlySnapshot(result);
 const backup={format:'finance-atlas',version:1,exportedAt:new Date().toISOString(),book:result.book};
 try{await writeFile(path.resolve(output),JSON.stringify(backup,null,2),{flag:'wx',mode:0o600});}catch(e){throw fail(e.code==='EEXIST'?'备份文件已存在，不会覆盖。':'私密备份文件无法写入。');}
 return {exported:true,hash:digest(backup),inputsHash:digest(checkedInputs(result.book)),assetCount:result.book.assets.length,recordCount:result.book.records.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);if(args.length!==3||args[0]!=='--local-feishu-read-only'||args[1]!=='--output')throw fail('请在本机使用 --local-feishu-read-only --output 私密文件。');console.log(JSON.stringify(await exportFeishuReadOnly({output:args[2]})));}
 catch(e){console.error(e.safe?e.message:'只读导出失败，请保留已有备份并检查本机配置。');process.exitCode=1;}
}
