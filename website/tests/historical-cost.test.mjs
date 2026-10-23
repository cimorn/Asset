import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

import {sourceTrees} from './source-trees.mjs';
const implementations=await Promise.all(sourceTrees.map(async([name,root])=>{
 const compiled=await build({stdin:{contents:"export * from './lib/finance.ts';export * from './lib/capital-accounts.ts';export * from './lib/asset-statistics.ts';export * from './lib/investing.ts';",resolveDir:fileURLToPath(root)},bundle:true,write:false,format:'esm',platform:'node'});
 const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 return {name,api};
}));

const rateHistory=[
 {date:'2026-09-01',rates:{CNY:1,USD:7,HKD:0.9},source:'test'},
 {date:'2026-09-15',rates:{CNY:1,USD:7.5,HKD:0.92},source:'test'},
 {date:'2026-10-01',rates:{CNY:1,USD:8,HKD:0.95},source:'test'},
];
const asset=(category='基金')=>({id:'synthetic',name:'Synthetic test asset',code:'',platform:'Synthetic platform',category,classification:category,market:'不适用',currency:'USD',value:120,cost:category==='现金'?null:100,proceeds:0,date:'2026-10-01',note:''});
const record=(id,date,type,after,extra={})=>({id,assetId:'synthetic',name:'Synthetic test asset',platform:'Synthetic platform',category:'基金',classification:'基金',currency:'USD',date,type,before:0,after,amount:0,note:'',...extra});
function book(api,overrides={}){return {...api.emptyBook(),initialized:true,ledgerAuthority:true,statisticsStart:'2026-09-01',rates:{...rateHistory.at(-1).rates},rateDate:'2026-10-01',rateHistory:structuredClone(rateHistory),assets:[asset()],records:[],...overrides};}

for(const {name,api} of implementations){
 test(name+': later valuation and FX updates preserve each historical purchase cost',()=>{
  const initial=book(api,{records:[record('opening','2026-09-01','买入',100,{settlement:-100,order:1})]});
  const projected=api.projectLedger(initial),purchase=projected.records.find(row=>row.id==='opening');
  assert.equal(purchase.exchangeRate,7);
  assert.equal(purchase.investedCny,700);
  assert.equal(api.investmentRows(projected)[0].netCostCny,700);
  assert.equal(api.assetFinancialRows(projected)[0].netInputCny,700);
  assert.equal(api.capitalAccounts(projected)[0].costCny,700);
  assert.equal(api.portfolioPerformance(projected,'CNY').total.cost,700);
  assert.equal(api.portfolioPerformance(projected,'CNY').groups['基金'].cost,700);
  assert.deepEqual(projected.gainSnapshots.map(point=>point.cnyInvested),[700,700,700]);
  const valued=api.projectLedger({...initial,records:[record('value','2026-10-01','更新',120,{order:2}),...initial.records]});
  assert.equal(api.investmentRows(valued)[0].investedCny,700);
  assert.equal(api.assetFinancialRows(valued)[0].netInputCny,700);
  assert.equal(api.capitalAccounts(valued)[0].costCny,700);
  assert.equal(api.portfolioPerformance(valued,'CNY').total.gain,260);
  assert.equal(valued.gainSnapshots.at(-1).cnyTotal,260);
 });

 test(name+': multiple purchases and sales use their own dates when computing net cost',()=>{
  const projected=api.projectLedger(book(api,{records:[
   record('sold','2026-10-01','卖出',140,{settlement:40,order:3}),
   record('second','2026-09-15','买入',150,{settlement:-50,order:2}),
   record('first','2026-09-01','买入',100,{settlement:-100,order:1}),
  ]}));
  const investment=api.investmentRows(projected)[0];
  assert.equal(investment.investedCny,1075);
  assert.equal(investment.proceedsCny,320);
  assert.equal(investment.netCostCny,755);
  assert.equal(api.assetFinancialRows(projected)[0].netInputCny,755);
  assert.equal(api.capitalAccounts(projected)[0].costCny,755);
  assert.equal(api.portfolioPerformance(projected,'CNY').total.cost,755);
  assert.equal(projected.records.find(row=>row.id==='first').exchangeRate,7);
  assert.equal(projected.records.find(row=>row.id==='second').exchangeRate,7.5);
  assert.equal(projected.records.find(row=>row.id==='sold').exchangeRate,8);
 });

 test(name+': neutral cash valuation preserves the first opening balance as historical basis',()=>{
  const projected=api.projectLedger(book(api,{assets:[asset('现金')],records:[
   record('value','2026-10-01','更新',120,{category:'现金',classification:'现金',order:2}),
   record('opening','2026-09-01','更新',100,{category:'现金',classification:'现金',order:1}),
  ]}));
  const financial=api.assetFinancialRows(projected)[0],account=api.capitalAccounts(projected).find(row=>row.currency==='USD');
  assert.equal(financial.netInput,100);
  assert.equal(financial.netInputCny,700);
  assert.equal(financial.gainCny,260);
  assert.equal(account.cost,100);
  assert.equal(account.costCny,700);
  assert.equal(api.portfolioPerformance(projected,'CNY').total.cost,700);
  assert.equal(api.portfolioPerformance(projected,'CNY').total.gain,260);
  assert.equal(projected.gainSnapshots.at(-1).cnyInvested,700);
  assert.equal(projected.gainSnapshots.at(-1).cnyTotal,260);
 });

 test(name+': remaining balance replacement preserves opening basis and actual movements',()=>{
  const cash={category:'现金',classification:'现金'};
  const projected=api.projectLedger(book(api,{assets:[asset('现金')],records:[
   record('spend','2026-10-01','消费',0,{...cash,settlement:-10,order:5}),
   record('income','2026-10-01','转入',0,{...cash,settlement:20,order:4}),
   record('valuation','2026-10-01','剩余',140,{...cash,remainingMode:'更新市值',order:3}),
   record('replacement','2026-09-15','剩余',120,{...cash,order:2}),
   record('opening','2026-09-01','剩余',100,{...cash,order:1}),
  ]}));
  const financial=api.assetFinancialRows(projected)[0];
  assert.equal(projected.assets[0].value,150);
  assert.equal(financial.netInput,110);
  assert.equal(financial.netInputCny,780);
  assert.equal(financial.gainCny,420);
  assert.equal(api.capitalAccounts(projected).find(row=>row.currency==='USD').costCny,780);
  assert.equal(api.portfolioPerformance(projected,'CNY').total.cost,780);
 });

 test(name+': valuation-only cash records do not create invested capital',()=>{
  const projected=api.projectLedger(book(api,{assets:[asset('现金')],records:[record('valuation','2026-09-01','剩余',100,{category:'现金',classification:'现金',remainingMode:'更新市值'})]}));
  assert.equal(api.assetFinancialRows(projected)[0].netInputCny,0);
  assert.equal(api.capitalAccounts(projected).find(row=>row.currency==='USD').costCny,0);
 });

 test(name+': dated legacy capital movements convert at the movement date',()=>{
  const legacy=book(api,{ledgerAuthority:false,assets:[],records:[]});
  api.changeCapital(legacy,asset(),100,'2026-09-01','dated-capital');
  assert.equal(legacy.capitalMovements[0].amountCny,700);
  assert.equal(api.capitalAccounts(legacy)[0].costCny,700);
  api.changeCapital(legacy,asset(),-25,'2026-09-15','dated-withdrawal');
  assert.equal(legacy.capitalMovements[1].amountCny,-187.5);
  assert.equal(api.capitalAccounts(legacy)[0].costCny,512.5);
 });
}
