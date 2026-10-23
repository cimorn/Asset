import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceDraft} from '../shared/merge.mjs';

test('new capitalBase row keeps an absent baseline with the normal JSON account key',()=>{
 const key=JSON.stringify(['银行','现金','CNY']),local={capitalBase:[{key,platform:'银行',classification:'现金',currency:'CNY',cost:100,costCny:100}]},remote=structuredClone(local);remote.capitalBase[0].cost=200;
 const advanced=advanceDraft({capitalBase:[]},local,remote);assert.deepEqual(advanced.base.capitalBase,[]);assert.deepEqual(advanced.local.capitalBase,local.capitalBase);assert.equal(advanced.local.capitalBase[0].key,key);
});

test('keyed row context is independent of string identity characters',()=>{
 const ids=['opening[cash]','[]','[',']','a.b','a/b','a\\b','a"b','a\nb','现金💰','rateHistory[2026-09-02]'];
 for(let code=0;code<128;code++)ids.push('record'+String.fromCharCode(code));
 for(const id of ids){
  const row={id,assetId:'cash',date:'2026-09-01',note:'local'},local={records:[row]},remote={records:[{...row,note:'remote'}]};
  const advanced=advanceDraft({records:[]},local,remote);assert.deepEqual(advanced.base.records,[]);assert.deepEqual(advanced.local.records,[row]);
 }
});
