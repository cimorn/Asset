import test from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {MongoClient} from 'mongodb';
import {initializeLedger} from '../scripts/init-ledger.mjs';
test('empty initialization previews without writing and refuses to replace an existing ledger',async t=>{
 const mongo=await MongoMemoryServer.create({binary:{version:'7.0.35'}});t.after(()=>mongo.stop());
 const client=await MongoClient.connect(mongo.getUri());t.after(()=>client.close());
 const database=client.db('asset_init_test'),environment={LEDGER_INSTANCE_ID:'init-test',LEDGER_ID:'main'};
 await initializeLedger({environment,database});assert.equal(await database.collection('ledgers').countDocuments(),0);
 await initializeLedger({environment,database,apply:true});const before=await database.collection('ledgers').findOne();
 await assert.rejects(initializeLedger({environment,database,apply:true}));assert.deepEqual(await database.collection('ledgers').findOne(),before);
});
