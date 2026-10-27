import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sourceTrees} from './source-trees.mjs';

for(const [name,root] of sourceTrees){
 const directory=await mkdtemp(path.join(tmpdir(),'asset-cost-ui-')),source=fileURLToPath(root),outfile=path.join(directory,'ui.cjs');
 await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {AssetView} from './components/finance-views';import {AssetLedgerTable,GroupedAssetDetails,GroupedAssetView} from './components/finance-asset-list';import {emptyBook,projectLedger} from './lib/finance';export function render(kind,hidden=false){const a={id:'test',name:'股市',platform:'Test bank',category:'股票',classification:'股市',currency:'USD',market:'不适用',value:110,cost:100,date:'2026-10-01',note:''};const common={assetId:a.id,name:a.name,platform:a.platform,category:a.category,classification:a.classification,currency:a.currency,before:0,amount:0,note:''};const book=projectLedger({...emptyBook(),initialized:true,ledgerAuthority:true,assets:[a],statisticsStart:'2026-09-01',rates:{CNY:1,USD:8,HKD:1},rateDate:'2026-10-01',rateHistory:[{date:'2026-09-01',rates:{CNY:1,USD:7,HKD:.9},source:'test'},{date:'2026-10-01',rates:{CNY:1,USD:8,HKD:1},source:'test'}],records:[{...common,id:'opening',date:'2026-09-01',type:'买入',after:100,settlement:-100,order:1},{...common,id:'value',date:'2026-10-01',type:'更新',after:110,order:2}]});const props={book,assets:book.assets,base:'CNY',hidden,onEdit:()=>{},onUpdate:()=>{},onIcon:()=>{}};return renderToStaticMarkup(kind==='table'?<AssetLedgerTable {...props}/>:kind==='group'?<GroupedAssetDetails {...props} kind="platform"/>:kind==='platform'?<GroupedAssetView {...props} kind="platform"/>:<AssetView {...props} filter={{}}/>);}`,resolveDir:source,loader:'tsx'},outfile,bundle:true,format:'cjs',platform:'node',packages:'external',tsconfig:path.join(source,'tsconfig.json'),banner:{js:`require=require('node:module').createRequire(${JSON.stringify(fileURLToPath(new URL('../package.json',import.meta.url)))});`}});
 const api=await import(pathToFileURL(outfile));
 for(const kind of ['table','group','platform','assets'])test(`${name}: ${kind} shows historical CNY cost separately from current value`,()=>{
  const html=api.render(kind);assert.match(html,/成本/);assert.match(html,/CNY/);assert.match(html,/700\.00/);assert.match(html,/880\.00/);
  if(kind==='assets'||kind==='group')assert.match(html,/180\.00/);
 });
 test(`${name}: hiding amounts also hides newly added costs`,()=>{for(const kind of ['table','group','platform','assets']){const html=api.render(kind,true);assert.doesNotMatch(html,/700\.00|880\.00|180\.00/);}});
 await rm(directory,{recursive:true,force:true});
}
