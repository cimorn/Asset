import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {sourceTrees} from './source-trees.mjs';

for(const [name,root] of sourceTrees){
 const compiled=await build({stdin:{contents:"export * from './lib/finance.ts';export * from './lib/asset-statistics.ts';",resolveDir:fileURLToPath(root)},bundle:true,write:false,format:'esm',platform:'node'});
 const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 function fixture(){
  const book=api.emptyBook();
  Object.assign(book,{initialized:true,ledgerAuthority:true,statisticsStart:'2026-09-01',rateDate:'2026-11-01',rates:{CNY:1,USD:9,HKD:1.1},rateHistory:[{date:'2026-09-01',rates:{CNY:1,USD:7,HKD:.9},source:'test'},{date:'2026-10-01',rates:{CNY:1,USD:8,HKD:1},source:'test'},{date:'2026-11-01',rates:{CNY:1,USD:9,HKD:1.1},source:'test'}]});
  const asset=(id,currency,category,classification)=>({id,name:id,platform:'Test bank',currency,category,classification,market:'不适用',value:0,cost:category==='现金'?null:0,date:'2026-09-01',note:''});
  book.assets=[asset('stock','USD','股票','股市'),asset('cash','HKD','现金','现金')];
  const row=(id,assetId,date,type,after,settlement,order)=>{const a=book.assets.find(a=>a.id===assetId);return {id,assetId,name:a.name,platform:a.platform,currency:a.currency,category:a.category,classification:a.classification,date,type,after,before:0,amount:0,note:'',order,...(settlement===undefined?{}:{settlement}),...(type==='剩余'?{remainingMode:'更新市值'}:{})};};
  book.records=[row('s1','stock','2026-09-01','买入',100,-100,1),row('s2','stock','2026-10-01','买入',120,-20,2),row('s3','stock','2026-11-01','更新',150,undefined,3),row('c1','cash','2026-09-01','转入',50,50,4),row('c2','cash','2026-10-01','转入',60,10,5),row('c3','cash','2026-11-01','剩余',70,undefined,6)];
  return api.projectLedger(book);
 }
 test(`${name}: filtered costs retain September basis and price later inputs at their own rates`,()=>{
  assert.equal(typeof api.assetFinancialSummary,'function');
  const book=fixture(),snapshot=JSON.stringify(book),stock=book.assets.filter(a=>a.id==='stock');
  const summary=api.assetFinancialSummary(book,'CNY',stock);
  assert.equal(summary.value,1350);assert.equal(summary.costCny,860);assert.equal(summary.cost,860);assert.equal(summary.gainCny,490);assert.equal(summary.nativeCosts.USD,120);
  const later={...book,rates:{...book.rates,USD:10}};
  assert.equal(api.assetFinancialSummary(later,'CNY',stock).costCny,860);
  assert.equal(api.assetFinancialSummary(later,'CNY',stock).gainCny,640);
  assert.equal(JSON.stringify(book),snapshot);
 });
 test(`${name}: grouped and filtered totals use matching assets including historical cash cost`,()=>{
  const book=fixture(),group=api.assetGroupSummaries(book,'CNY','platform')[0];
  assert.equal(group.costCny,915);assert.equal(group.gainCny,512);assert.deepEqual(group.nativeCosts,{USD:120,HKD:60});
  const cash=api.assetGroupSummaries(book,'CNY','platform',book.assets.filter(a=>a.id==='cash'))[0];
  assert.equal(cash.value,77);assert.equal(cash.costCny,55);assert.equal(cash.gainCny,22);
  const currencies=api.assetGroupSummaries(book,'CNY','currency');
  assert.equal(currencies.find(a=>a.name==='USD').costCny,860);
  assert.equal(currencies.find(a=>a.name==='HKD').costCny,55);
 });
 test(`${name}: an unknown cost stays unknown and an empty selection has zero totals`,()=>{
  assert.equal(typeof api.assetFinancialSummary,'function');
  const book=fixture();
  assert.equal(api.assetFinancialSummary(book,'CNY',[]).costCny,0);
  const unknown={...book,ledgerAuthority:false,assets:[{...book.assets[0],cost:null}],records:[],investments:[]};
  const summary=api.assetFinancialSummary(unknown,'CNY');
  assert.equal(summary.costCny,null);assert.equal(summary.gainCny,null);assert.equal(summary.nativeCosts.USD,null);
 });
}
