import path from 'node:path';
import {listPackage,extractFile,statFile} from '@electron/asar';
import {createHash} from 'node:crypto';
export const packageEntries=Object.freeze(['main.cjs','server.mjs','config-path.mjs','credential-startup.mjs','nas-service.mjs','nas-credentials.mjs','nas-cache.mjs','nas-merge.mjs','nas-legacy.mjs','nas-security.mjs','nas-rate-draft.mjs','rate-draft.mjs','feishu-ledger.mjs','feishu-merge.mjs','runtime/finance.mjs','web-dist']);
export function resolvePackageOutput(args,root){
 const index=args.indexOf('--output'),value=index<0?path.join(root,'dist'):args[index+1];
 if(typeof value!=='string'||!path.isAbsolute(value))throw Error('Packaging output must be an absolute staging directory.');
 const result=path.resolve(value);return result;
}
export function inspectArchive(archive){
 const files=listPackage(archive).map(name=>name.replaceAll('\\','/').replace(/^\//,''));
 if(files.some(name=>/(?:^|\/)(?:\.env|nas\.env|credentials\.mjs|feishu\.mjs|feishu-cache\.mjs|mydaily-client|.*-cache\.json|.*-upload\.json|node_modules)(?:\/|$)/.test(name)))throw Error('Package contains excluded private or old transport files.');
 const bundled=[];for(const name of files){const native=path.normalize(name),info=statFile(archive,native,false);if(info.files)continue;if(info.link||info.unpacked)throw Error('Package content must be contained in the archive.');const bytes=extractFile(archive,native);if(/\.(?:mjs|cjs|js|json|html)$/.test(name)&&/mongodb(?:\+srv)?:\/\//i.test(bytes.toString('utf8')))throw Error('Package contains a database connection URI.');bundled.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 return bundled;
}
