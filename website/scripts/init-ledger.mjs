import {pathToFileURL} from 'node:url';
import {createMongoService} from '../server/mongo-ledger.mjs';
import {emptyBook} from '../server/runtime/finance.mjs';

export async function initializeLedger({environment=process.env,database,apply=false}={}){
 const service=await createMongoService({environment,database});
 try{return await service.importBook(emptyBook(),{apply});}
 finally{await service.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error('参数无效');
  const result=await initializeLedger({apply:process.argv.includes('--apply')});
  console.log(JSON.stringify({applied:result.applied??false}));
 }catch{console.error('初始化失败：目标必须是空账本，请检查数据库连接；已有账本保持原样。');process.exitCode=1;}
}
