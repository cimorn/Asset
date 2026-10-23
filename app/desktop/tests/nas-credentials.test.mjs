import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareCredentials} from '../credential-startup.mjs';

test('NAS credentials validate canonical origins and import separately from personal .env',async t=>{
 const module=new URL('../nas-credentials.mjs',import.meta.url);
 assert.ok(existsSync(module),'NAS credential isolation module must exist');
 const {createNasCredentialStore,normalizeNasUrl}=await import(module);
 const root=await mkdtemp(path.join(os.tmpdir(),'nas-credentials-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'.env'),'PERSONAL=untouched\n');
 const chosen=path.join(root,'selected.env');await writeFile(chosen,'NAS_URL=https://asset.example.test\nNAS_PASSWORD="test password"\n');
 const store=createNasCredentialStore({root});assert.equal((await store.status()).configured,false);await store.configure(chosen);
 assert.deepEqual(await store.load(),{url:'https://asset.example.test',password:'test password'});
 assert.equal(await readFile(path.join(root,'.env'),'utf8'),'PERSONAL=untouched\n');assert.equal(path.basename(store.filename),'nas.env');
 for(const value of ['http://asset.example.test','https://user:pass@asset.example.test','https://asset.example.test/path','https://asset.example.test?x=1','https://asset.example.test#x','https://ASSET.example.test','https://asset.example.test:443','https://asset.example.test\\evil',' https://asset.example.test','https://asset.example.test.','file:///tmp/test'])assert.throws(()=>normalizeNasUrl(value),{safe:true},value);
 assert.throws(()=>normalizeNasUrl('http://127.0.0.1:4321'));assert.equal(normalizeNasUrl('http://127.0.0.1:4321',{allowLocalHttp:true}),'http://127.0.0.1:4321');assert.throws(()=>normalizeNasUrl('http://127.0.0.2:4321',{allowLocalHttp:true}));
 await writeFile(chosen,'NAS_URL=https://asset.example.test\nNAS_PASSWORD=\n');await assert.rejects(store.configure(chosen));assert.equal((await store.load()).password,'test password');
});
test('import preserves exact NAS password characters and rejects unrelated credential keys',async t=>{
 const {createNasCredentialStore}=await import('../nas-credentials.mjs'),root=await mkdtemp(path.join(os.tmpdir(),'nas-password-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=createNasCredentialStore({root}),chosen=path.join(root,'input.env');
 await writeFile(chosen,"NAS_URL=https://asset.example.test\nNAS_PASSWORD='a\"b\\c'\n");await store.configure(chosen);assert.equal((await store.load()).password,'a"b\\c');
 await writeFile(chosen,'NAS_URL=https://asset.example.test\nNAS_PASSWORD=x\nMONGODB_URI=mongodb://private\n');await assert.rejects(store.configure(chosen));assert.ok(!(await readFile(store.filename,'utf8')).includes('MONGODB_URI'));
});
test('startup prompts for missing or invalid NAS config and preserves original personal file',async t=>{
 const {createNasCredentialStore}=await import('../nas-credentials.mjs'),root=await mkdtemp(path.join(os.tmpdir(),'nas-startup-'));t.after(()=>rm(root,{recursive:true,force:true}));const store=createNasCredentialStore({root}),chosen=path.join(root,'choice.env');await writeFile(path.join(root,'.env'),'PERSONAL=original\n');await writeFile(chosen,'NAS_URL=https://asset.example.test\nNAS_PASSWORD=test\n');
 let prompts=0;assert.equal(await prepareCredentials(store,{chooseFile:async reason=>{assert.match(reason,/NAS/);prompts++;return chosen;},showError:async()=>false}),true);assert.equal(prompts,1);assert.equal(await readFile(path.join(root,'.env'),'utf8'),'PERSONAL=original\n');
 await writeFile(store.filename,'NAS_URL=http://foreign.invalid\nNAS_PASSWORD=test\n');assert.equal(await prepareCredentials(store,{chooseFile:async()=>{prompts++;return '';},showError:async()=>false}),false);assert.equal(prompts,2);assert.equal(await readFile(path.join(root,'.env'),'utf8'),'PERSONAL=original\n');
});
