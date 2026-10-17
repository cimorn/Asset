import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// Exercise both shipped implementations, without a server, network, or persisted book.
for(const tree of ['website','app']){
 const folder=await mkdtemp(path.join(tmpdir(),'asset-adjustments-')),outfile=path.join(folder,'finance.mjs');
 let api;
 try{
  await build({stdin:{contents:"export * from './lib/finance.ts';export * from './lib/ledger.ts';export * from './lib/asset-statistics.ts';",resolveDir:fileURLToPath(new URL(`../../${tree}/`,import.meta.url))},outfile,bundle:true,format:'esm',platform:'node'});
  api=await import(pathToFileURL(outfile));
 }finally{await rm(folder,{recursive:true,force:true});}
 const opening='2026-09-01',adjustment='2026-10-03';
 function fixture(){
  const book=api.emptyBook();Object.assign(book,{initialized:true,ledgerAuthority:true,statisticsStart:opening,rateDate:adjustment,rates:{CNY:1,USD:8,HKD:.9},rateHistory:[{date:opening,rates:{CNY:1,USD:7,HKD:.9},source:'fixture'},{date:adjustment,rates:{CNY:1,USD:8,HKD:.9},source:'fixture'}]});
  const row=(id,platform,classification,category,value,cost,currency='CNY')=>({id,name:id,platform,classification,category,currency,value,cost,market:'不适用',date:opening,note:'original '+id});
  book.assets=[row('cash','Bank','现金','现金',1000,null),row('fund','Broker','基金','基金',200,150),row('crypto','Exchange','虚拟币','其他',10,10,'USD'),row('remaining','Exchange','虚拟币','现金',20,null,'USD')];
  book.records=book.assets.map((asset,index)=>({id:'opening-'+asset.id,assetId:asset.id,name:asset.name,platform:asset.platform,classification:asset.classification,category:asset.category,currency:asset.currency,date:opening,type:asset.category==='现金'?'剩余':'买入',before:0,after:asset.value,amount:asset.value,note:'original record '+asset.id,order:index+1,...(asset.category==='现金'?{}:{settlement:-asset.cost})}));
  return api.projectLedger(book);
 }
 const asset=(book,id)=>book.assets.find(row=>row.id===id);
 const investment=(book,id)=>api.investmentRows(book).find(row=>row.assetId===id);
 const principal=book=>api.capitalAccounts(book).reduce((sum,row)=>sum+row.costCny,0);
 const created=(before,after)=>after.records.filter(row=>!before.records.some(old=>old.id===row.id));
 const transfer=(book,options={})=>api.applyAction(book,{type:'transfer',id:'fund',targetId:'cash',amount:210,sourceValue:0,date:adjustment,note:'adjustment fixture',...options});
 function originalsUnchanged(before,after){
  const inputs=api.ledgerInputs(before),next=api.ledgerInputs(after);
  for(const row of inputs.records)assert.deepEqual(next.records.find(candidate=>candidate.id===row.id),row);
 }
 function linked(before,after,source,target){
  assert.deepEqual(after.assets.map(row=>row.id).sort(),before.assets.map(row=>row.id).sort());
  const rows=created(before,after);assert.equal(rows.length,2);
  const out=rows.find(row=>row.assetId===source),incoming=rows.find(row=>row.assetId===target);
  assert.ok(out?.transferId);assert.equal(out.transferId,incoming?.transferId);
  assert.equal(out.transferLeg,'out');assert.equal(incoming.transferLeg,'in');
  assert.equal(out.counterpartyId,target);assert.equal(incoming.counterpartyId,source);
  assert.equal(out.note,'adjustment fixture');assert.equal(incoming.note,'adjustment fixture');
  originalsUnchanged(before,after);return {out,incoming};
 }
 test(`${tree}: dated reclassification adds a neutral event and preserves history, value, and basis`,()=>{
  const book=fixture(),frozen=structuredClone(book),next=api.applyAction(book,{type:'classify',id:'fund',classification:'虚拟币',date:adjustment});
  assert.deepEqual(book,frozen);originalsUnchanged(book,next);
  assert.equal(asset(next,'fund').classification,'虚拟币');assert.equal(asset(next,'fund').value,200);assert.equal(asset(next,'fund').cost,150);
  assert.equal(principal(next),principal(book));assert.equal(investment(next,'fund').netCostCny,150);
  const rows=created(book,next);assert.equal(rows.length,1);assert.equal(rows[0].classificationChange,true);assert.equal(rows[0].previousClassification,'基金');
  assert.equal(api.recordDisplay(rows[0]).direction,'neutral');assert.equal(rows[0].before,200);assert.equal(rows[0].after,200);assert.equal(rows[0].settlement,undefined);
  assert.equal(api.ledgerAtDate(next,opening).assets.find(row=>row.id==='fund').classification,'基金');
  assert.equal(next.gainSnapshots.find(row=>row.date===opening).cnyInvestedCategories.基金,150);
  assert.equal(next.gainSnapshots.find(row=>row.date===adjustment).cnyInvestedCategories.虚拟币,360);
 });
 test(`${tree}: reclassification persists beyond future valuations carrying older metadata`,()=>{
  let book=fixture();const future='2026-10-10';
  book.rateHistory.push({date:future,rates:{CNY:1,USD:8,HKD:.9},source:'fixture'});
  book.records.push({...book.records.find(row=>row.assetId==='fund'),id:'future-fund-value',date:future,type:'更新市值',after:250,settlement:undefined,order:5});book=api.projectLedger(book);
  const next=api.applyAction(book,{type:'classify',id:'fund',classification:'虚拟币',date:adjustment});
  assert.equal(asset(next,'fund').classification,'虚拟币');assert.equal(asset(next,'fund').value,250);originalsUnchanged(book,next);
  assert.equal(api.ledgerAtDate(next,opening).assets.find(row=>row.id==='fund').classification,'基金');
  assert.equal(next.gainSnapshots.find(row=>row.date===future).cnyInvestedCategories.基金,0);
 });
 test(`${tree}: repeated same-day classification replaces one stable event`,()=>{
  const book=fixture(),first=api.applyAction(book,{type:'classify',id:'fund',classification:'虚拟币',date:adjustment});
  const next=api.applyAction(first,{type:'classify',id:'fund',classification:'股市',date:adjustment});
  const old=first.records.find(row=>row.classificationChange),rows=next.records.filter(row=>row.classificationChange);
  assert.equal(rows.length,1);assert.equal(rows[0].id,old.id);assert.equal(rows[0].previousClassification,'基金');assert.equal(rows[0].classification,'股市');
  assert.equal(asset(next,'fund').value,200);assert.equal(principal(next),1360);originalsUnchanged(book,next);
 });
 test(`${tree}: changing a remaining classification preserves cash behavior and cash kind on roundtrip`,()=>{
  const book=fixture(),next=api.applyAction(book,{type:'classify',id:'remaining',classification:'基金',date:adjustment});
  const marker=next.records.find(row=>row.classificationChange);assert.ok(marker.balanceKind);
  const restored=api.projectLedger(JSON.parse(JSON.stringify(api.ledgerInputs(next))));
  assert.equal(asset(restored,'remaining').category,'现金');assert.equal(asset(restored,'remaining').classification,'基金');assert.equal(asset(restored,'remaining').cost,null);
  assert.equal(investment(restored,'remaining'),undefined);assert.equal(principal(restored),1360);
  const funded=transfer(restored,{id:'cash',targetId:'remaining',amount:80,sourceValue:undefined});
  assert.equal(asset(funded,'remaining').value,30);assert.equal(asset(funded,'remaining').category,'现金');
  assert.equal(created(restored,funded).find(row=>row.assetId==='remaining').remainingMode,'转入');
 });
 test(`${tree}: cash reclassification cannot leak future investment grouping into earlier dates`,()=>{
  const book=fixture(),next=api.applyAction(book,{type:'classify',id:'cash',classification:'基金',date:adjustment});
  for(const replay of [next,api.projectLedger(next),api.projectLedger(JSON.parse(JSON.stringify(api.ledgerInputs(next))))]){
   const earlier=api.ledgerAtDate(replay,opening);
   assert.equal(api.accountClassification(asset(earlier,'cash')),'现金');
   assert.equal(earlier.gainSnapshots.find(row=>row.date===opening).cnyInvestedCategories.基金,150);
   assert.equal(api.accountClassification(asset(replay,'cash')),'基金');
  }
 });
 test(`${tree}: metadata update cannot rewrite historic classification`,()=>{
  const book=fixture(),original=structuredClone(book);
  assert.throws(()=>api.applyAction(book,{type:'update',asset:{...asset(book,'fund'),classification:'黄金',category:'黄金'}}),/分类/);
  assert.deepEqual(book,original);
 });
 test(`${tree}: a fund sale into existing cash preserves realized gains and external capital`,()=>{
  const book=fixture(),frozen=structuredClone(book),next=transfer(book),{out,incoming}=linked(book,next,'fund','cash');
  assert.deepEqual(book,frozen);assert.equal(asset(next,'fund').value,0);assert.equal(asset(next,'cash').value,1210);
  assert.equal(api.recordDisplay(out).label,'卖出');assert.equal(out.settlement,210);assert.equal(out.positionDelta,-200);
  assert.equal(incoming.type,'剩余');assert.equal(incoming.remainingMode,'转入');assert.equal(incoming.settlement,210);
  assert.equal(investment(next,'fund').proceeds,210);assert.equal(investment(next,'fund').gain,60);assert.equal(investment(next,'fund').gainCny,60);
  assert.equal(principal(next),1360);assert.equal(api.portfolioPerformance(next,'CNY').total.gain,90);
 });
 test(`${tree}: fund to crypto cross-currency fees use source funding CNY basis`,()=>{
  const book=fixture(),next=transfer(book,{targetId:'crypto',amount:200,targetAmount:24}),{out,incoming}=linked(book,next,'fund','crypto');
  assert.equal(asset(next,'fund').value,0);assert.equal(asset(next,'crypto').value,34);
  assert.equal(api.recordDisplay(out).label,'卖出');assert.equal(api.recordDisplay(incoming).label,'买入');assert.equal(incoming.settlement,-24);
  assert.equal(incoming.fundingCurrency,'CNY');assert.equal(incoming.fundingAmount,200);assert.equal(incoming.settlementCny,-200);assert.equal(incoming.positionDelta,24);
  assert.equal(investment(next,'crypto').invested,34);assert.equal(investment(next,'crypto').investedCny,270);assert.equal(investment(next,'crypto').gainCny,2);
  assert.equal(principal(next),1360);assert.equal(api.assetSummary(next.assets,'CNY',next.rates).value,1432);assert.equal(api.portfolioPerformance(next,'CNY').total.gain,72);
 });
 test(`${tree}: investment remaining cash transfers directly across platform and classification`,()=>{
  const book=fixture(),next=transfer(book,{id:'cash',targetId:'remaining',amount:80,sourceValue:undefined}),{out,incoming}=linked(book,next,'cash','remaining');
  assert.equal(asset(next,'cash').value,920);assert.equal(asset(next,'remaining').value,30);
  assert.equal(out.type,'剩余');assert.equal(out.remainingMode,'转出');assert.equal(incoming.type,'剩余');assert.equal(incoming.remainingMode,'转入');
  assert.equal(investment(next,'remaining'),undefined);assert.equal(principal(next),1360);
  const account=api.capitalAccounts(next).find(row=>row.platform==='Exchange'&&row.classification==='虚拟币'&&row.currency==='USD');
  assert.equal(account.cost,40);assert.equal(account.costCny,290);
 });
 test(`${tree}: cash buys a holding across platform and class with dated default conversion`,()=>{
  const book=fixture(),next=transfer(book,{id:'cash',targetId:'crypto',amount:80,sourceValue:undefined}),{out,incoming}=linked(book,next,'cash','crypto');
  assert.equal(asset(next,'cash').value,920);assert.equal(asset(next,'crypto').value,20);
  assert.equal(out.remainingMode,'转出');assert.equal(api.recordDisplay(incoming).label,'买入');assert.equal(incoming.settlement,-10);
  assert.equal(investment(next,'crypto').invested,20);assert.equal(investment(next,'crypto').netCostCny,150);assert.equal(principal(next),1360);
 });
 test(`${tree}: USD funding keeps native receipt separate from historic CNY basis`,()=>{
  const book=fixture(),next=transfer(book,{id:'remaining',targetId:'fund',amount:5,sourceValue:undefined,targetAmount:38,targetValue:238});
  const {incoming}=linked(book,next,'remaining','fund');assert.equal(incoming.fundingCurrency,'USD');assert.equal(incoming.fundingAmount,5);assert.equal(incoming.settlement,-38);assert.equal(incoming.settlementCny,-40);
  assert.equal(asset(next,'remaining').value,15);assert.equal(investment(next,'fund').invested,188);assert.equal(investment(next,'fund').investedCny,190);
  assert.equal(principal(next),1360);assert.equal(api.portfolioPerformance(next,'CNY').total.gain,78);
  const rerated=api.applyAction(next,{type:'rates',date:adjustment,rates:{CNY:1,USD:9,HKD:.9},source:'fixture revised'});
  assert.equal(rerated.records.find(row=>row.id===incoming.id).settlementCny,-45);assert.equal(investment(rerated,'fund').investedCny,195);assert.equal(principal(rerated),1360);
 });
 test(`${tree}: JSON ledger input roundtrip preserves transfer links, funding, and position deltas`,()=>{
  const book=fixture(),next=transfer(book,{targetId:'crypto',amount:200,targetAmount:24,targetValue:35});
  const classified=api.applyAction(next,{type:'classify',id:'crypto',classification:'黄金',date:adjustment}),inputs=api.ledgerInputs(classified);
  const restored=api.projectLedger(JSON.parse(JSON.stringify(inputs)));originalsUnchanged(book,restored);
  for(const row of classified.records.filter(record=>record.transferId||record.classificationChange)){
   const input=inputs.records.find(record=>record.id===row.id),output=restored.records.find(record=>record.id===row.id);
   for(const key of ['transferId','transferLeg','counterpartyId','fundingCurrency','fundingAmount','positionDelta','classificationChange','previousClassification','balanceKind']){assert.equal(input[key],row[key],key);assert.equal(output[key],row[key],key);}
  }
  assert.equal(asset(restored,'crypto').value,35);assert.equal(asset(restored,'crypto').classification,'黄金');assert.equal(principal(restored),1360);
  assert.deepEqual(api.capitalAccounts(restored),api.capitalAccounts(classified));assert.deepEqual(api.investmentRows(restored),api.investmentRows(classified));
 });
 test(`${tree}: transfer backfill uses dated balances and replays future cash movements`,()=>{
  let book=fixture();book.records.push({...book.records.find(row=>row.assetId==='remaining'),id:'later-remaining-in',date:adjustment,type:'剩余',remainingMode:'转入',settlement:5,after:25,order:5});book=api.projectLedger(book);
  const next=transfer(book,{id:'remaining',targetId:'cash',amount:10,sourceValue:undefined,date:opening}),{out,incoming}=linked(book,next,'remaining','cash');
  assert.equal(out.before,20);assert.equal(out.after,10);assert.equal(out.exchangeRate,7);assert.equal(incoming.settlement,70);
  assert.equal(asset(next,'remaining').value,15);assert.equal(asset(next,'cash').value,1070);assert.equal(principal(next),1400);
  assert.throws(()=>transfer(book,{id:'remaining',targetId:'cash',amount:22,sourceValue:undefined,date:opening}),/余额不足|超出|不能超过/);
 });
 test(`${tree}: invalid transfer inputs fail without mutating the original book`,()=>{
  const book=fixture(),frozen=structuredClone(book);
  const invalid=[{targetId:'fund'},{targetId:'missing'},{id:'missing'},{date:'2026-10-04'},{date:'2026-02-30'},{amount:-1},{amount:NaN},{amount:0},{id:'cash',targetId:'crypto',amount:1001,sourceValue:undefined},{sourceValue:-1},{targetAmount:NaN}];
  for(const options of invalid){assert.throws(()=>transfer(book,options),error=>error instanceof Error&&!/不支持的操作/.test(error.message),JSON.stringify(options));assert.deepEqual(book,frozen);}
  const unopened=structuredClone(book);unopened.records.find(row=>row.assetId==='crypto').date=adjustment;
  assert.throws(()=>transfer(api.projectLedger(unopened),{targetId:'crypto',date:opening,amount:20,sourceValue:180}),/目标|尚未|建立/);
  for(const options of [{classification:''},{id:'missing',classification:'基金'},{classification:'基金',date:'2026-10-04'}]){
   assert.throws(()=>api.applyAction(book,{type:'classify',id:'fund',date:adjustment,...options}),error=>error instanceof Error&&!/不支持的操作/.test(error.message));assert.deepEqual(book,frozen);
  }
 });
 test(`${tree}: backfilled transfers reject future cash overdrafts and future position oversales`,()=>{
  let cashBook=fixture();cashBook.records.push({...cashBook.records.find(row=>row.assetId==='remaining'),id:'later-cash-out',date:adjustment,type:'剩余',remainingMode:'转出',settlement:-15,after:5,order:5});cashBook=api.projectLedger(cashBook);
  const frozen=structuredClone(cashBook);assert.throws(()=>transfer(cashBook,{id:'remaining',targetId:'cash',amount:10,sourceValue:undefined,date:opening}),/余额不足|负|超出/);assert.deepEqual(cashBook,frozen);
  const start=fixture(),future=transfer(start,{amount:100,sourceValue:80});
  assert.throws(()=>transfer(future,{amount:80,sourceValue:100,date:opening}),/不足|负|超出|不能超过/);
 });
 test(`${tree}: legacy trade actions also reject concurrent overselling after merging`,()=>{
  const book=fixture(),first=api.applyAction(book,{type:'trade',id:'fund',kind:'sell',amount:100,value:80,newCash:{balance:0},date:adjustment}),second=api.applyAction(book,{type:'trade',id:'fund',kind:'sell',amount:110,value:70,newCash:{balance:0},date:adjustment});
  const existing=new Set(book.records.map(record=>record.id));
  const merged={...first,assets:[...first.assets,...second.assets.filter(asset=>!first.assets.some(item=>item.id===asset.id))],records:[...first.records,...second.records.filter(record=>!existing.has(record.id))]};
  assert.throws(()=>api.projectLedger(merged),/持仓不足|超出/);
 });
 test(`${tree}: independently valid concurrent position outflows cannot silently oversell on merge`,()=>{
  const book=fixture(),first=transfer(book,{amount:100,sourceValue:80}),second=transfer(book,{amount:110,sourceValue:70});
  const firstInputs=api.ledgerInputs(first),secondInputs=api.ledgerInputs(second),baseIds=new Set(book.records.map(row=>row.id));
  const merged={...firstInputs,records:[...firstInputs.records,...secondInputs.records.filter(row=>!baseIds.has(row.id))]};
  assert.throws(()=>api.projectLedger(merged),/不足|负|超出|不能超过/);assert.equal(asset(book,'fund').value,200);
 });
}
