import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

for(const tree of ['website','app']){
 const folder=await mkdtemp(path.join(tmpdir(),'asset-cash-remaining-'));
 const outfile=path.join(folder,'finance.mjs');
 await build({entryPoints:[fileURLToPath(new URL(`../../${tree}/lib/finance.ts`,import.meta.url))],outfile,bundle:true,platform:'node',format:'esm',target:'node22'});
 const {emptyBook,projectLedger,applyAction,ledgerInputs}=await import(pathToFileURL(outfile));
 await rm(folder,{recursive:true,force:true});
 function fixture(currency='CNY',value=10736.20){
  const book=emptyBook();book.initialized=true;book.ledgerAuthority=true;book.statisticsStart='2026-09-01';
  book.rateHistory=[{date:'2026-09-01',rates:{CNY:1,USD:6.6784,HKD:0.8544},source:'test'},{date:'2026-10-03',rates:{CNY:1,USD:6.6987,HKD:0.8534},source:'test'}];
  book.rates={...book.rateHistory.at(-1).rates};book.rateDate='2026-10-03';
  book.assets=[{id:'cash',name:'Cash',platform:'全平台',currency,category:'现金',classification:'现金',market:'不适用',value,cost:null,date:'2026-09-01',note:''}];
  book.records=[{id:'opening',assetId:'cash',name:'Cash',platform:'全平台',currency,category:'现金',classification:'现金',date:'2026-09-01',type:'剩余',before:0,after:value,amount:value,note:'original',order:1}];
  return projectLedger(book);
 }
 const spend=(book,value)=>applyAction(book,{type:'cash',id:'cash',kind:'消费',value,date:'2026-10-03'});
 test(`${tree}: entering remaining balance records consumption difference and reduces capital without a loss`,()=>{
  const before=fixture(),original=ledgerInputs(before),next=spend(before,10000),record=next.records.find(r=>r.id!=='opening');
  assert.equal(next.assets[0].value,10000);
  assert.equal(next.capitalAccounts[0].cost,10000);
  assert.equal(next.capitalAccounts[0].costCny,10000);
  assert.equal(record.before,10736.20);assert.equal(record.after,10000);
  assert.equal(record.type,'剩余');assert.equal(record.remainingMode,'消费');assert.equal(record.settlement,-736.20);
  assert.equal(record.amount,-736.20);
  assert.equal(next.gainSnapshots.at(-1).cnyTotal,0);
  assert.deepEqual(ledgerInputs(before),original);
  assert.deepEqual(ledgerInputs(next).records.find(r=>r.id==='opening'),original.records[0]);
 });
 test(`${tree}: zero remaining balance consumes the full balance`,()=>{
  const next=spend(fixture(),0);
  assert.equal(next.assets[0].value,0);assert.equal(next.capitalAccounts[0].costCny,0);
  assert.equal(next.records.find(r=>r.id!=='opening').settlement,-10736.20);
 });
 test(`${tree}: invalid or increased remaining balance is rejected without changing the book`,()=>{
  const before=fixture(),original=ledgerInputs(before);
  assert.throws(()=>spend(before,10736.21),/剩余余额不能大于当前余额/);
  for(const value of [-1,NaN,Infinity,'100'])assert.throws(()=>spend(before,value),/剩余余额/);
  assert.deepEqual(ledgerInputs(before),original);
 });
 test(`${tree}: unchanged remaining balance does not create a zero consumption record`,()=>{
  assert.throws(()=>spend(fixture(),10736.20),/剩余余额未减少/);
 });
 test(`${tree}: foreign currency consumption uses operation FX while the original capital retains purchase FX`,()=>{
  const next=spend(fixture('USD',100),95);
  assert.equal(next.assets[0].value,95);assert.equal(next.capitalAccounts[0].cost,95);
  assert.equal(next.capitalAccounts[0].costCny,634.35);
  assert.equal(next.records.find(r=>r.id!=='opening').settlement,-5);
  assert.equal(next.gainSnapshots.at(-1).cnyTotal,2.03);
 });
 test(`${tree}: existing amount based consumption remains compatible`,()=>{
  const next=applyAction(fixture('USD',100),{type:'cash',id:'cash',kind:'消费',amount:5,date:'2026-10-03'});
  assert.equal(next.assets[0].value,95);assert.equal(next.records.find(r=>r.id!=='opening').settlement,-5);
 });
}
