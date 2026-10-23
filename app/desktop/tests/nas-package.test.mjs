import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createPackage} from '../node_modules/@electron/asar/lib/asar.js';

test('2.0.8 portable packaging has explicit NAS-only transport and external staging override',async()=>{
 assert.ok(existsSync(new URL('../package-manifest.mjs',import.meta.url)),'NAS packaging manifest must exist');const {packageEntries,resolvePackageOutput}=await import('../package-manifest.mjs');
 assert.ok(packageEntries.includes('nas-service.mjs'));assert.ok(packageEntries.includes('nas-credentials.mjs'));assert.ok(packageEntries.includes('nas-cache.mjs'));assert.ok(packageEntries.includes('feishu-ledger.mjs'));assert.ok(!packageEntries.includes('feishu.mjs'));assert.ok(!packageEntries.includes('credentials.mjs'));assert.ok(!packageEntries.includes('mydaily-client'));assert.ok(!packageEntries.some(n=>n.endsWith('.env')||n.includes('cache.json')));
 const root=path.resolve(new URL('../..',import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/,''));const target=path.resolve(root,'../../output/asset-nas-20261011/desktop');assert.equal(resolvePackageOutput(['--output',target],root),target);assert.equal(resolvePackageOutput([],root),path.join(root,'dist'));assert.throws(()=>resolvePackageOutput(['--output','relative'],root));
 assert.equal(JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version,'2.0.8');
});
test('archive inspector reads Windows nested paths and rejects private files and Mongo connection strings',async t=>{
 const {inspectArchive}=await import('../package-manifest.mjs');assert.equal(typeof inspectArchive,'function','NAS archive inspector must be available');const root=await mkdtemp(path.join(os.tmpdir(),'nas-asar-'));t.after(()=>rm(root,{recursive:true,force:true}));const app=path.join(root,'app');await mkdir(path.join(app,'web-dist','assets'),{recursive:true});await mkdir(path.join(app,'empty'),{recursive:true});await writeFile(path.join(app,'web-dist','assets','main.js'),'console.log("NAS")');let archive=path.join(root,'safe.asar');await createPackage(app,archive);assert.deepEqual(inspectArchive(archive).map(f=>f.path),['web-dist/assets/main.js']);
 await writeFile(path.join(app,'.env'),'SECRET=private');archive=path.join(root,'private.asar');await createPackage(app,archive);assert.throws(()=>inspectArchive(archive));await rm(path.join(app,'.env'));await writeFile(path.join(app,'web-dist','assets','main.js'),'mongodb://private:password@host');archive=path.join(root,'uri.asar');await createPackage(app,archive);assert.throws(()=>inspectArchive(archive));
});
