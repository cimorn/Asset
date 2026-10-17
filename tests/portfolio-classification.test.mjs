import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

for(const tree of ['website','app']){
 const folder=await mkdtemp(path.join(tmpdir(),'asset-four-class-')),outfile=path.join(folder,'finance.mjs');
 await build({stdin:{contents:"export * from './lib/finance.ts';export * from './lib/ledger.ts';export * from './lib/asset-statistics.ts';export * from './lib/investing.ts';",resolveDir:fileURLToPath(new URL(`../../${tree}/`,import.meta.url))},outfile,bundle:true,format:'esm',platform:'node'});
 const api=await import(pathToFileURL(outfile));await rm(folder,{recursive:true,force:true});
 const start='2026-09-01',next='2026-10-02',last='2026-10-12';
 function fixture(){
  const book=api.emptyBook();Object.assign(book,{initialized:true,ledgerAuthority:true,statisticsStart:start,rates:{CNY:1,USD:8,HKD:1},rateDate:last,rateHistory:[start,next,last].map((date,index)=>({date,rates:{CNY:1,USD:index?8:7,HKD:1},source:'test'}))});
  const asset=(id,name,classification,category,value)=>({id,name,code:'',classification,category,platform:'test',currency:'CNY',market:'不适用',value,cost:category==='现金'?null:value,date:start,note:''});
  book.assets=[asset('stock','股票','股市','股票',100),asset('fund','东方添益债券','基金','基金',200),asset('cash','人民币','现金','现金',1000)];
  book.records=book.assets.map((row,index)=>({id:'opening-'+row.id,assetId:row.id,name:row.name,code:row.code,classification:row.classification,category:row.category,platform:row.platform,currency:row.currency,date:start,type:row.category==='现金'?'剩余':'买入',before:0,after:row.value,amount:row.value,order:index+1,note:'',...(row.category!=='现金'?{settlement:-row.value}:{})}));
  book.records.push({...book.records[0],id:'stock-value',date:next,type:'更新',after:120,order:4});
  book.records.push({...book.records[1],id:'fund-value',date:next,type:'更新',after:210,order:5});
  return api.projectLedger(book);
 }
 test(`${tree}: classification choices are exactly the four requested groups`,()=>{
  assert.deepEqual(api.classificationOptions(fixture()),['股市','黄金','虚拟币','现金']);
 });
 test(`${tree}: historical cash correction rebuilds every investment point without changing transaction values`,()=>{
  const before=fixture(),inputs=api.ledgerInputs(before);
  for(const record of inputs.records)if(record.assetId==='fund')record.classification='现金';
  const after=api.projectLedger(inputs);
  assert.deepEqual(after.records.map(({id,date,amount,after,settlement})=>({id,date,amount,after,settlement})),before.records.map(({id,date,amount,after,settlement})=>({id,date,amount,after,settlement})));
  for(const date of [start,next,last]){
   const book=api.ledgerAtDate(after,date),overview=api.investmentOverview(book,'CNY');
   assert.equal(book.assets.find(row=>row.id==='fund').classification,'现金');
   assert.equal(overview.summary.value,date===start?100:120);
   assert.ok(!overview.classified.some(row=>row.name==='基金'));
   assert.ok(Math.abs(overview.classified.reduce((sum,row)=>sum+row.share,0)-100)<1e-10);
   const total=api.assetSummary(book.assets,'CNY',book.rates).value;
   assert.equal(overview.classified.find(row=>row.name==='现金').share,(date===start?1200:1210)/total*100);
  }
  assert.deepEqual(after.snapshots.map(row=>row.investmentTotals.CNY),[100,120,120]);
  assert.deepEqual(after.gainSnapshots.map(api.investmentReturn),[0,20,20]);
 });
 test(`${tree}: moving a holding to cash preserves its historical cost and market value`,()=>{
  const before=fixture(),after=api.applyAction(before,{type:'classify',id:'fund',classification:'现金',date:next});
  assert.equal(api.accountClassification(after.assets.find(row=>row.id==='fund')),'现金');
  assert.equal(after.assets.find(row=>row.id==='fund').value,210);
  assert.equal(api.portfolioPerformance(after,'CNY').total.cost,1300);
  assert.equal(api.portfolioPerformance(after,'CNY').total.gain,30);
  assert.equal(api.portfolioPerformance(after,'CNY').groups['现金'].cost,1200);
  assert.equal(api.portfolioPerformance(after,'CNY').groups['现金'].gain,10);
  assert.equal(api.investmentOverview(after,'CNY').summary.value,120);
  assert.equal(api.assetSummary(after.assets,'CNY',after.rates).cash,1210);
  assert.deepEqual(api.ledgerInputs(after).records.filter(r=>!r.classificationChange),api.ledgerInputs(before).records);
  const replayed=api.projectLedger(JSON.parse(JSON.stringify(api.ledgerInputs(after))));
  assert.deepEqual(api.capitalAccounts(replayed),api.capitalAccounts(after));
 });
 test(`${tree}: cash-classified holding can sell and transfer without losing its cost or gain`,()=>{
  const before=api.applyAction(fixture(),{type:'classify',id:'fund',classification:'现金',date:next});
  const after=api.applyAction(before,{type:'transfer',id:'fund',targetId:'stock',amount:100,sourceValue:110,targetValue:220,date:last});
  assert.equal(api.portfolioPerformance(after,'CNY').total.cost,1300);
  assert.equal(api.portfolioPerformance(after,'CNY').total.gain,30);
  assert.equal(api.portfolioPerformance(after,'CNY').investment.cost,200);
  assert.equal(api.portfolioPerformance(after,'CNY').groups['现金'].cost,1100);
  assert.equal(api.ledgerAtDate(after,start).assets.find(row=>row.id==='fund').classification,'基金');
 });
 test(`${tree}: overall investment return excludes the cash balance and cash gains`,()=>{
  const after=api.applyAction(fixture(),{type:'classify',id:'fund',classification:'现金',date:next});
  const point=after.gainSnapshots.find(row=>row.date===next);
  assert.equal(typeof api.investmentReturn,'function');
  assert.equal(api.investmentReturn(point),20);
  assert.equal(api.investmentReturn({...point,cnyInvestmentCost:0}),null);
 });
 test(`${tree}: editing cash-classified holding metadata does not turn the historical investment into a balance`,()=>{
  const book=api.applyAction(fixture(),{type:'classify',id:'fund',classification:'现金',date:next});
  const asset=book.assets.find(row=>row.id==='fund');
  const after=api.applyAction(book,{type:'update',asset:{...asset,note:'metadata'}});
  assert.equal(api.portfolioPerformance(after,'CNY').total.cost,1300);
  assert.equal(api.portfolioPerformance(after,'CNY').groups['现金'].gain,10);
  assert.equal(after.assets.find(row=>row.id==='fund').note,'metadata');
 });
 test(`${tree}: requested asset codes do not rename the currency or change unrelated tickers`,()=>{
  assert.equal(typeof api.standardAssetCode,'function');
  for(const [name,expected] of [['人民币','RMB'],['港币','HKD'],['美元','USD'],['USDT','USDT'],['现金','cash']])assert.equal(api.standardAssetCode(name,''),expected);
  assert.equal(api.standardAssetCode('东方添益债券','400030'),'400030');
 });
 test(`${tree}: transfer accounts are partitioned by classification without losing selections`,()=>{
  assert.equal(typeof api.assetOptionGroups,'function');
  const book=api.applyAction(fixture(),{type:'classify',id:'fund',classification:'现金',date:next});
  const groups=api.assetOptionGroups(book.assets);
  assert.deepEqual(groups.map(group=>group.label),['股市','现金']);
  assert.deepEqual(groups.flatMap(group=>group.options.map(option=>option.value)).sort(),book.assets.map(asset=>asset.id).sort());
  assert.equal(groups.find(group=>group.label==='现金').options.length,2);
 });
}
