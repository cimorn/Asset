import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sourceTrees} from './source-trees.mjs';

for(const [tree,sourceRoot] of sourceTrees){
 const folder=await mkdtemp(path.join(tmpdir(),'asset-cash-dates-')),outfile=path.join(folder,'finance.mjs');
 await build({stdin:{contents:"export * from './lib/finance.ts';export * from './lib/ledger.ts';export * from './lib/asset-statistics.ts';",resolveDir:fileURLToPath(sourceRoot)},outfile,bundle:true,format:'esm',platform:'node'});
 const api=await import(pathToFileURL(outfile));await rm(folder,{recursive:true,force:true});
 const dates=['2026-09-01','2026-09-15','2026-10-03'];
 function fixture(later=true){
  const book=api.emptyBook();Object.assign(book,{initialized:true,ledgerAuthority:true,statisticsStart:dates[0],rateDate:dates[2],rateHistory:dates.map((date,i)=>({date,rates:{CNY:1,USD:7+i,HKD:.9+i*.01},source:'test'}))});book.rates={...book.rateHistory.at(-1).rates};
  const row=(id,classification,category,value,currency='CNY')=>({id,name:id,platform:id,currency,category,classification,market:'不适用',value,cost:category==='现金'?null:value,date:dates[0],note:''});
  book.assets=[row('cash','现金','现金',100,'USD'),row('gold','黄金','现金',40),row('fund','基金','基金',200),row('target','股市','现金',30,'USD')];
  book.records=book.assets.map((a,i)=>({id:'opening-'+a.id,assetId:a.id,name:a.name,platform:a.platform,currency:a.currency,category:a.category,classification:a.classification,date:dates[0],type:a.category==='现金'?'剩余':'买入',before:0,after:a.value,amount:a.value,note:'original',order:i+1,...(a.category!=='现金'?{settlement:-a.value}:{})}));
  if(later)book.records.push({...book.records[0],id:'later-in',date:dates[2],type:'剩余',remainingMode:'转入',settlement:20,after:120,order:5});
  return api.projectLedger(book);
 }
 test(`${tree}: remaining backfill uses balance on its FX date and replays later flows`,()=>{
  const book=fixture(),inputs=api.ledgerInputs(book),next=api.applyAction(book,{type:'cash',id:'cash',kind:'消费',value:90,date:dates[1]});
  const created=next.records.find(r=>!book.records.some(old=>old.id===r.id));
  assert.equal(created.before,100);assert.equal(created.after,90);assert.equal(created.settlement,-10);assert.equal(created.exchangeRate,8);
  assert.equal(next.assets.find(a=>a.id==='cash').value,110);
  assert.deepEqual(api.ledgerInputs(book),inputs);
  for(const record of inputs.records)assert.deepEqual(api.ledgerInputs(next).records.find(r=>r.id===record.id),record);
 });
 test(`${tree}: transfer backfill uses historic balances and preserves both sides and total`,()=>{
  const book=fixture(),next=api.applyAction(book,{type:'cash',id:'cash',kind:'转账',targetId:'target',amount:10,date:dates[1]});
  assert.equal(next.assets.find(a=>a.id==='cash').value,110);assert.equal(next.assets.find(a=>a.id==='target').value,40);
  assert.equal(next.records.filter(r=>r.date===dates[1]).length,2);
  assert.equal(next.records.filter(r=>r.date===dates[1]).reduce((s,r)=>s+r.settlement,0),0);
 });
 test(`${tree}: deposits backfill and dates without saved FX cannot create flows or change FX`,()=>{
  const book=fixture(),next=api.applyAction(book,{type:'cash',id:'cash',kind:'存入',amount:5,date:dates[1]});
  assert.equal(next.assets.find(a=>a.id==='cash').value,125);
  for(const kind of ['存入','转账','消费'])assert.throws(()=>api.applyAction(book,{type:'cash',id:'cash',kind,amount:5,value:95,targetId:'target',date:'2026-10-04'}),/已保存.*汇率|汇率.*日期/);
  assert.throws(()=>api.applyAction(book,{type:'cash',id:'cash',kind:'存入',amount:5,date:dates[1],exchangeRate:6}),/汇率/);
 });
 test(`${tree}: historic remaining rejects a balance exceeding that day, future overdrafts, and unopened targets`,()=>{
  const book=fixture();
  assert.throws(()=>api.applyAction(book,{type:'cash',id:'cash',kind:'消费',value:110,date:dates[1]}),/剩余余额不能大于/);
  const later=structuredClone(book);later.records.find(r=>r.id==='later-in').remainingMode='消费';later.records.find(r=>r.id==='later-in').settlement=-20;
  assert.throws(()=>api.applyAction(api.projectLedger(later),{type:'cash',id:'cash',kind:'消费',value:10,date:dates[1]}),/余额不足/);
  const unopened=structuredClone(book);unopened.records.find(r=>r.id==='opening-target').date=dates[2];
  assert.throws(()=>api.applyAction(api.projectLedger(unopened),{type:'cash',id:'cash',kind:'转账',amount:10,targetId:'target',date:dates[1]}),/目标账户|转出/);
 });
 test(`${tree}: investment summary excludes the cash classification, retains remaining investment balances, and places cash last`,()=>{
  const book=fixture(false),overview=api.investmentOverview(book,'CNY');
  assert.equal(overview.summary.value,510);assert.equal(overview.performance.cost,450);assert.equal(overview.performance.gain,60);
  assert.equal(overview.classified.at(-1).name,'现金');assert.equal(overview.classified.at(-1).share,900/1410*100);
  assert.equal(overview.classified.find(row=>row.name==='股市').value,270);
  assert.ok(Math.abs(overview.classified.reduce((s,r)=>s+r.share,0)-100)<1e-10);
  assert.equal(book.snapshots.at(-1).investmentTotals.USD,30);
  assert.equal(book.gainSnapshots.at(-1).cnyInvestmentTotal,60);
  assert.equal(book.gainSnapshots.at(-1).cnyTotal,260);
  assert.equal(api.assetSummary(book.assets,'CNY',book.rates).value,1410);
 });
 test(`${tree}: purchases and sales can use historic saved dates and preserve future valuations`,()=>{
  let book=fixture(false);book.assets.find(a=>a.id==='target').classification='基金';book.assets.find(a=>a.id==='target').platform='fund';Object.assign(book.records.find(r=>r.assetId==='target'),{classification:'基金',platform:'fund'});
  book.records.push({...book.records.find(r=>r.assetId==='fund'),id:'fund-value',date:dates[2],type:'更新市值',after:250,settlement:undefined,order:6});
  book=api.projectLedger(book);const inputs=api.ledgerInputs(book);
  const bought=api.applyAction(book,{type:'trade',id:'fund',kind:'buy',amount:10,value:210,newCash:{balance:50},date:dates[1]});
  assert.equal(bought.assets.find(a=>a.id==='fund').value,250);assert.equal(bought.assets.find(a=>a.id==='fund').cost,210);
  assert.equal(bought.records.find(r=>r.assetId==='fund'&&r.date===dates[1]).before,200);
  const sold=api.applyAction(book,{type:'trade',id:'fund',kind:'sell',amount:10,value:190,newCash:{balance:50},date:dates[1]});
  assert.equal(sold.assets.find(a=>a.id==='fund').value,250);assert.equal(sold.assets.find(a=>a.id==='fund').proceeds,10);
  for(const r of inputs.records)assert.deepEqual(api.ledgerInputs(bought).records.find(row=>row.id===r.id),r);
 });
 test(`${tree}: asset additions accept prior saved dates, retain new metadata, and reject any unsaved business date`,()=>{
  const book=fixture(false),asset={id:'new',name:'New fund',platform:'new',category:'基金',classification:'基金',currency:'USD',market:'不适用',value:5,cost:5,date:dates[1],note:'preserve new note'};
  const added=api.applyAction(book,{type:'add',assets:[asset],date:dates[1]});
  assert.equal(added.assets.find(a=>a.id==='new').note,asset.note);assert.equal(added.capitalAccounts.find(a=>a.platform==='new').costCny,40);
  assert.throws(()=>api.applyAction(book,{type:'add',assets:[{...asset,date:'2026-10-04'}],date:'2026-10-04'}),/已保存.*汇率|汇率.*日期/);
  for(const kind of ['buy','sell','sellAll','value'])assert.throws(()=>api.applyAction(book,{type:'trade',id:'fund',kind,amount:1,value:kind==='sellAll'?0:200,newCash:{balance:50},date:'2026-10-04'}),/已保存.*汇率|汇率.*日期/);
  assert.throws(()=>api.applyAction(book,{type:'position',id:'fund',quantity:1,unitPrice:200,cost:200,date:'2026-10-04'}),/已保存.*汇率|汇率.*日期/);
  const future=structuredClone(book);future.records.find(r=>r.assetId==='fund').date=dates[2];
  assert.throws(()=>api.applyAction(api.projectLedger(future),{type:'add',assets:[{...asset,id:'fund'}],date:dates[1]}),/重复/);
 });
}
