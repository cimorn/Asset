import test from 'node:test';
import assert from 'node:assert/strict';
import {createMongoService} from '../server/mongo-ledger.mjs';
test('runtime refuses administrator or other database credentials before connecting',async()=>{
 await assert.rejects(createMongoService({environment:{MONGODB_URI:'mongodb://root:private@127.0.0.1:1/asset?authSource=admin'}}),e=>e.safe&&/asset_app/.test(e.message)&&!e.message.includes('private'));
});
test('TLS verification cannot be disabled with case-insensitive URI option names',async()=>{
 await assert.rejects(createMongoService({environment:{MONGODB_URI:'mongodb://asset_app:private@127.0.0.1:1/asset?authSource=asset&tlsallowinvalidcertificates=TRUE'}}),e=>e.safe&&/TLS/.test(e.message));
});
