import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createMongoService,checkedInputs,digest,localMigrationBackup} from '../server/mongo-ledger.mjs';
const fail=message=>Object.assign(new Error(message),{safe:true});
export async function runMaintenance({args=process.argv.slice(2),environment=process.env,database}={}){
 const [command,...rest]=args;if(!['export','import','restore'].includes(command))throw fail('请使用 export --output、import --input 或 restore --input；写入须加 --apply。');
 const flags={};for(let i=0;i<rest.length;i++){const key=rest[i];if(key==='--apply'){flags.apply=true;continue;}if(!['--input','--output'].includes(key)||flags[key]||!rest[i+1]||rest[i+1].startsWith('--'))throw fail('维护命令参数无效。');flags[key]=rest[++i];}
 if(command==='export'&&(!flags['--output']||flags['--input']||flags.apply)||command!=='export'&&(!flags['--input']||flags['--output']))throw fail('维护命令参数无效。');
 let source;if(command!=='export'){try{source=JSON.parse(await readFile(path.resolve(flags['--input']),'utf8'));}catch{throw fail('备份文件无法读取或 JSON 无效。');}}
 const migration=command==='import'?localMigrationBackup(source):null;
 const service=await createMongoService({environment,database});
 try{
  if(command==='export'){
   const backup=await service.exportBackup();try{await writeFile(path.resolve(flags['--output']),JSON.stringify(backup,null,2),{flag:'wx',mode:0o600});}catch(e){throw fail(e.code==='EEXIST'?'输出文件已存在，请使用新的私密备份文件。':'备份写入失败，请检查私密目录权限。');}
   return {exported:true,hash:backup.hash,versionCount:backup.versions.length};
  }
  const result=command==='import'?await service.importBook(migration.book,{apply:!!flags.apply,migration:migration.migration}):await service.restoreBackup(source,{apply:!!flags.apply});
  if(flags.apply){const actual=checkedInputs((await service.pull()).book),expected=command==='import'?checkedInputs(migration.book):source.versions.find(v=>v._id===source.ledger.versionId).inputs;if(digest(actual)!==digest(expected))throw fail('导入回读摘要不一致，请保留原始备份并检查数据库。');result.verified=true;}
  return result;
 }finally{await service.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await runMaintenance()));}catch(e){console.error(e.safe?e.message:'维护失败；备份与正式账本已保留，请检查服务端配置。');process.exitCode=1;}
}
