import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const script=await readFile(new URL('../../deploy/docker/init-mongo.js',import.meta.url),'utf8'),require=createRequire(import.meta.url);
function init(uri,existing=false){let created;runInNewContext(script,{require,process:{env:{MONGODB_URI:uri}},db:{getSiblingDB:name=>{assert.equal(name,'asset');return {getUser:user=>{assert.equal(user,'asset_app');return existing?{user}:null;},createUser:entry=>{created=entry;}}}}});return JSON.parse(JSON.stringify(created));}
test('storage initialization reuses only the asset readWrite credential including encoded characters',()=>{
 const result=init('mongodb://asset_app:a%40b%3Ac%24d@mongodb:27017/asset?authSource=asset');assert.deepEqual(result,{user:'asset_app',pwd:'a@b:c$d',roles:[{role:'readWrite',db:'asset'}]});
});
test('storage initialization rejects another database or an existing account without changing it',()=>{
 assert.throws(()=>init('mongodb://asset_app:private@mongodb:27017/website?authSource=asset'),/configuration is invalid/);
 assert.throws(()=>init('mongodb://asset_app:private@mongodb:27017/asset?authSource=asset',true),/empty application account/);
});
