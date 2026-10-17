import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {emptyBook} from '../server/runtime/finance.mjs';

test('maintenance CLI accepts original finance-atlas and defaults to dry run; full backup restores history',async t=>{
 const module=await import('../scripts/mongo-maintenance.mjs').catch(()=>({}));assert.equal(typeof module.runMaintenance,'function','maintenance CLI must exist');
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.35'}}),client=await MongoClient.connect(mongo.getUri());
 const db=client.db('asset_maintenance_test_'+randomUUID().replaceAll('-','')),restoreDb=client.db('asset_restore_test_'+randomUUID().replaceAll('-',''));t.after(async()=>{await db.dropDatabase();await restoreDb.dropDatabase();await client.close();await mongo.stop();});
 const dir=await mkdtemp(path.join(tmpdir(),'asset-maintenance-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const input=path.join(dir,'source.json'),output=path.join(dir,'backup.json'),environment={LEDGER_INSTANCE_ID:'maintenance-test'};await writeFile(input,JSON.stringify({format:'finance-atlas',version:1,exportedAt:new Date().toISOString(),book:emptyBook()}));
 const run=(args,database=db)=>module.runMaintenance({args,environment,database});
 assert.equal((await run(['import','--input',input])).applied,false);assert.equal(await db.collection('ledgers').countDocuments(),0);assert.equal((await run(['import','--input',input,'--apply'])).verified,true);
 await run(['export','--output',output]);const backup=JSON.parse(await readFile(output));assert.equal(backup.format,'asset-mongo-backup');await assert.rejects(run(['export','--output',output]),/存在/);
 assert.equal((await run(['restore','--input',output],restoreDb)).applied,false);assert.equal((await run(['restore','--input',output,'--apply'],restoreDb)).verified,true);await assert.rejects(run(['import','--input',input,'--apply']),/空账本/);
});
