import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {mergeBooks} from '../shared/merge.mjs';
import {sourceTrees} from './source-trees.mjs';

for(const [tree,sourceRoot] of sourceTrees){
 const folder=await mkdtemp(path.join(tmpdir(),'asset-history-'));
 const outfile=path.join(folder,'finance.mjs');
 await build({entryPoints:[fileURLToPath(new URL('lib/finance.ts',sourceRoot))],outfile,bundle:true,platform:'node',format:'esm',target:'node22'});
 const finance=await import(pathToFileURL(outfile));
 await rm(folder,{recursive:true,force:true});
 const {emptyBook,projectLedger,ledgerInputs,applyAction,investmentRows}=finance;
 function fixture(cash=false){
  const book=emptyBook();book.initialized=true;book.ledgerAuthority=true;book.statisticsStart='2026-09-01';
  book.rateHistory=[['2026-09-01',6.6784],['2026-10-02',6.6987],['2026-10-03',6.8]].map(([date,USD])=>({date,rates:{CNY:1,USD,HKD:0.85},source:'test'}));
  book.rates={...book.rateHistory.at(-1).rates};book.rateDate='2026-10-03';
  book.assets=[{id:'asset',name:'Test',code:'T',platform:'Test',currency:'USD',category:cash?'现金':'股票',classification:'股市',market:'不适用',value:100,cost:cash?null:100,date:'2026-09-01',note:''}];
  book.records=[{id:'opening',assetId:'asset',name:'Test',platform:'Test',currency:'USD',category:cash?'现金':'股票',classification:'股市',date:'2026-09-01',type:cash?'剩余':'买入',before:0,after:100,amount:100,...(!cash?{settlement:-100}:{}),note:'',order:1}];
  return projectLedger(book);
 }
 test(`${tree}: historical valuation can be backfilled without repricing purchase cost or replacing later valuation`,()=>{
  let book=applyAction(fixture(),{type:'trade',id:'asset',kind:'value',value:120,date:'2026-10-03'});
  book=applyAction(book,{type:'trade',id:'asset',kind:'value',value:110,date:'2026-10-02'});
  assert.equal(book.assets[0].value,120);assert.equal(book.assets[0].date,'2026-10-03');
  assert.equal(investmentRows(book)[0].investedCny,667.84);
  assert.equal(book.snapshots.find(point=>point.date==='2026-10-02').totals.USD,110);
  assert.equal(book.snapshots.find(point=>point.date==='2026-10-03').totals.USD,120);
 });
 test(`${tree}: same-date valuation replaces its record and leaves the buy unchanged`,()=>{
  let book=applyAction(fixture(),{type:'trade',id:'asset',kind:'value',value:110,date:'2026-10-02'});
  const updateId=book.records.find(r=>r.date==='2026-10-02').id;
  book=applyAction(book,{type:'trade',id:'asset',kind:'value',value:115,date:'2026-10-02'});
  assert.equal(book.records.filter(r=>r.date==='2026-10-02').length,1);
  assert.equal(book.records.find(r=>r.date==='2026-10-02').id,updateId);
  assert.equal(book.assets[0].value,115);assert.equal(book.records.find(r=>r.id==='opening').settlement,-100);
 });
 test(`${tree}: cash remaining valuation replaces balance, keeps opening basis and replays later consumption`,()=>{
  let book=applyAction(fixture(true),{type:'cash',id:'asset',kind:'更新市值',value:105,date:'2026-10-02'});
  book=applyAction(book,{type:'cash',id:'asset',kind:'消费',amount:5,date:'2026-10-03'});
  book=applyAction(book,{type:'cash',id:'asset',kind:'更新市值',value:108,date:'2026-10-02'});
  assert.equal(book.assets[0].value,103);assert.equal(book.records.filter(r=>r.date==='2026-10-02').length,1);
  assert.equal(book.records.find(r=>r.date==='2026-10-02').remainingMode,'更新市值');
  assert.equal(book.records.find(r=>r.id==='opening').after,100);
  assert.equal(book.capitalAccounts[0].costCny,633.84);
 });
 test(`${tree}: valuation requires an exact confirmed FX date and cannot predate opening`,()=>{
  assert.throws(()=>applyAction(fixture(),{type:'trade',id:'asset',kind:'value',value:110,date:'2026-09-15'}),/汇率/);
  const book=fixture();book.rateHistory.unshift({date:'2026-08-01',rates:{CNY:1,USD:6.5,HKD:0.85},source:'test'});delete book.statisticsStart;
  assert.throws(()=>applyAction(book,{type:'trade',id:'asset',kind:'value',value:110,date:'2026-08-01'}),/首次|建立|流水/);
 });
 test(`${tree}: same-date records without order keep the original remaining opening basis`,()=>{
  let book=fixture(true);
  const opening={...book.records[0]};delete opening.order;
  book.records=[{...opening,id:'old-value',after:120,remainingMode:'更新市值'},opening];
  book=projectLedger(book);
  book=applyAction(book,{type:'cash',id:'asset',kind:'更新市值',value:115,date:'2026-09-01'});
  assert.equal(book.records.find(record=>record.id==='opening').after,100);
  assert.equal(book.records.find(record=>record.id==='old-value').after,115);
  assert.equal(book.capitalAccounts[0].costCny,667.84);
 });
 test(`${tree}: concurrent first valuations on the same asset/date conflict instead of adding duplicate records`,()=>{
  const base=fixture(),local=applyAction(base,{type:'trade',id:'asset',kind:'value',value:110,date:'2026-10-02'}),remote=applyAction(base,{type:'trade',id:'asset',kind:'value',value:120,date:'2026-10-02'});
  const merged=mergeBooks(ledgerInputs(base),ledgerInputs(local),ledgerInputs(remote));
  assert.ok(merged.conflicts.length>0);
  assert.equal(merged.book.records.filter(record=>record.date==='2026-10-02').length,1);
 });
 test(`${tree}: an explicitly marked first valuation is replaced without becoming an opening deposit`,()=>{
  let book=fixture(true);book.records[0].remainingMode='更新市值';book=projectLedger(book);
  book=applyAction(book,{type:'cash',id:'asset',kind:'更新市值',value:110,date:'2026-09-01'});
  book=applyAction(book,{type:'cash',id:'asset',kind:'更新市值',value:120,date:'2026-09-01'});
  assert.equal(book.records.length,1);assert.equal(book.records[0].id,'opening');assert.equal(book.records[0].after,120);
  assert.equal(book.capitalAccounts[0].costCny,0);
 });
 test(`${tree}: normalized unmarked noncash opening remains intact on same-date valuation`,()=>{
  let book=fixture();book.records[0].type='新增资产';book.records[0].note='opening note';delete book.records[0].settlement;
  book=projectLedger(ledgerInputs(projectLedger(book)));
  book=applyAction(book,{type:'trade',id:'asset',kind:'value',value:120,date:'2026-09-01'});
  assert.equal(book.records.length,2);assert.equal(book.records.find(record=>record.id==='opening').after,100);
  assert.equal(book.records.find(record=>record.id==='opening').note,'opening note');assert.equal(book.assets[0].value,120);
 });
}
