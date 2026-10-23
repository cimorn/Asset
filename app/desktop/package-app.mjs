import {mkdir,cp,writeFile,readFile,rename,stat,mkdtemp,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {build,Platform,Arch} from 'electron-builder';
import {createPackage} from '@electron/asar';
import {createHash} from 'node:crypto';
import {packageEntries,resolvePackageOutput,inspectArchive} from './package-manifest.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.dirname(here),output=resolvePackageOutput(process.argv.slice(2),root);
const metadata=JSON.parse(await readFile(path.join(here,'package.json'),'utf8'));
const electron=JSON.parse(await readFile(path.join(here,'node_modules/electron/package.json'),'utf8'));
const tempRoot=path.resolve(os.tmpdir());
const work=await mkdtemp(path.join(tempRoot,'finance-atlas-package-'));
try{
 const native=path.join(work,'app'),application=path.join(native,'resources/app');
 await cp(path.join(here,'node_modules/electron/dist'),native,{recursive:true});
 await rename(path.join(native,'electron.exe'),path.join(native,'资产罗盘.exe'));
 await mkdir(application,{recursive:true});
 // Explicit contents: credentials, caches, development dependencies and backups are never bundled.
 for(const name of packageEntries){
  await mkdir(path.dirname(path.join(application,name)),{recursive:true});
  await cp(path.join(here,name),path.join(application,name),{recursive:true});
 }
 await writeFile(path.join(application,'package.json'),JSON.stringify({name:metadata.name,productName:metadata.productName,version:metadata.version,main:'main.cjs',type:'module'}));
 const archive=path.join(native,'resources/app.asar');await createPackage(application,archive);
 const bundled=inspectArchive(archive);
 if(path.dirname(application)!==path.join(native,'resources'))throw Error('Invalid staged application path');await rm(application,{recursive:true,force:true});
 const artifacts=path.join(work,'output');
 await build({
  projectDir:here,prepackaged:native,publish:'never',
  targets:Platform.WINDOWS.createTarget('portable',Arch.x64),
  config:{
   appId:'com.financeatlas.desktop',productName:'资产罗盘',
   electronVersion:electron.version,npmRebuild:false,compression:'maximum',
   directories:{output:artifacts},
   win:{icon:path.join(root,'public/favicon.ico'),signAndEditExecutable:false},
   portable:{artifactName:'资产罗盘.exe',requestExecutionLevel:'user',unpackDirName:false},
  },
 });
 await mkdir(output,{recursive:true});
 const executable=path.join(output,'资产罗盘.exe'),pending=executable+'.tmp';
 await cp(path.join(artifacts,'资产罗盘.exe'),pending);
 await rename(pending,executable);
 await cp(archive,path.join(output,'app.asar'));
 const bytes=await readFile(executable),sha256=createHash('sha256').update(bytes).digest('hex');
 await writeFile(path.join(output,'package-manifest.json'),JSON.stringify({version:metadata.version,format:'portable-x64',executable:'资产罗盘.exe',bytes:bytes.length,sha256,entries:packageEntries,excluded:['.env','nas.env','all credential/cache/upload JSON','credentials.mjs','feishu.mjs','mydaily-client','MongoDB URI/password','node_modules'],files:bundled},null,2));
 console.log(JSON.stringify({executable,version:metadata.version,bytes:(await stat(executable)).size,sha256,format:'portable-x64',bundledFiles:bundled.length,exclusionCheck:'PASS'}));
}finally{
 // Only remove this invocation's own temporary build directory.
 if(path.dirname(work)!==tempRoot||!path.basename(work).startsWith('finance-atlas-package-')||(await lstat(work)).isSymbolicLink())throw new Error('Invalid temporary build path');
 await rm(work,{recursive:true,force:true});
}
