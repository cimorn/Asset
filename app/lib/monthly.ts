import type {Asset,Book} from './finance.ts';

export type MonthAsset=Asset & {inflow:number;outflow:number};
export type MonthSnapshot={date:string;assets:MonthAsset[];rates:Record<string,number>;savedAt:string};
export type MonthEntry={assetId:string;value:number;inflow:number;outflow:number};
export type MonthAction={type:'month';mode?:'append'|'replace';date:string;entries:MonthEntry[];rates:Record<string,number>};
export type PerformanceRow={asset:MonthAsset;opening:number;closing:number;inflow:number;outflow:number;gain:number;returnRate:number|null;openingCny:number;closingCny:number;netFlowCny:number;gainCny:number;assetGainCny:number;fxGainCny:number};
export type Performance={startDate:string;endDate:string;rows:PerformanceRow[];opening:number;closing:number;netFlow:number;gain:number;assetGain:number;fxGain:number;returnRate:number|null;spansMonths:boolean};

export function monthlyAssets(book:Book,correcting=false):Asset[]{
 const months=book.months??[];
 if(correcting)return [...(months.at(-1)?.assets??[])];
 const previous=months.at(correcting?-2:-1);
 const byId=new Map<string,Asset>();
 for(const asset of previous?.assets??[])if(asset.value>0)byId.set(asset.id,asset);
 for(const asset of book.closedAssets??[])byId.set(asset.id,{...asset,value:0});
 for(const asset of book.assets)byId.set(asset.id,asset);
 return [...byId.values()];
}
function moneyInput(value:unknown,label:string){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12)throw new Error(`${label}须为 0 至 1 万亿之间的数字`);
 return Math.round(value*100)/100;
}
export function applyMonth(book:Book,action:MonthAction,currentDate:string):Book{
 const date=action.date;
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date<'1900-01-01'||date>currentDate)throw new Error('估值日期无效或晚于今天');
 const months=book.months??[],last=months.at(-1);
 if(last&&date.slice(0,7)<last.date.slice(0,7))throw new Error('只能新增月份或修正最近一个月，较早历史保留不变');
 const correcting=!!last&&date.slice(0,7)===last.date.slice(0,7);
 if(action.mode!==undefined&&!['append','replace'].includes(action.mode))throw new Error('月度保存模式无效');
 if(action.mode==='append'&&correcting)throw new Error('新增月份必须晚于最近月份；修改已有月份请用“修正最近月份”');
 if(action.mode==='replace'&&!correcting)throw new Error('只能修正最近月份，新增月份请使用更新入口');
 const previous=months.at(correcting?-2:-1);
 if(previous&&date<=previous.date)throw new Error('估值日期须晚于上一期');
 const expected=monthlyAssets(book,correcting);
 if(!expected.length)throw new Error('请先添加资产，再建立月度起点');
 if(!Array.isArray(action.entries)||action.entries.length!==expected.length)throw new Error('请逐项确认全部资产，包含本期已清仓的资产');
 const byId=new Map(action.entries.map(entry=>[entry?.assetId,entry]));
 if(byId.size!==expected.length||expected.some(asset=>!byId.has(asset.id)))throw new Error('资产列表不完整或重复，请重新打开月度更新');
 if(!action.rates||typeof action.rates!=='object'||action.rates.CNY!==1)throw new Error('请确认月度汇率，CNY 必须为 1');
 const rates:Record<string,number>={CNY:1};
 for(const currency of new Set(expected.map(asset=>asset.currency))){const rate=action.rates[currency];if(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||rate>1e6)throw new Error(`${currency} 月度汇率无效`);rates[currency]=rate;}
 const assets:MonthAsset[]=expected.map(asset=>{
  const entry=byId.get(asset.id)!;
  const value=moneyInput(entry.value,`${asset.name} 期末余额`),inflow=moneyInput(entry.inflow,'本期转入'),outflow=moneyInput(entry.outflow,'本期转出');
  if(!previous&&(inflow||outflow))throw new Error('首期只建立余额起点，不填写期间资金进出');
  const old=previous?.assets.find(a=>a.id===asset.id);
  if(old&&old.currency!==asset.currency)throw new Error('同一资产的月度币种不能更改');
  return {...asset,value,inflow,outflow,date};
 });
 const next=structuredClone(book);
 const snap:MonthSnapshot={date,assets,rates,savedAt:new Date().toISOString()};
 next.months=correcting?[...months.slice(0,-1),snap]:[...months,snap];
 if(!correcting)next.closedAssets=[];
 if(next.months.length>1200||next.records.length+assets.length>20000)throw new Error('账本已达到容量上限，请先导出备份');
 for(const asset of assets){
  const current=next.assets.find(a=>a.id===asset.id);
  // An asset removed from current holdings can still be settled, but must not be silently revived.
  if(!current&&asset.value!==0&&!correcting)throw new Error(`${asset.name} 已移除，请将清仓余额填为 0；仍持有时请先恢复资产`);
  const before=current?.value??0;
  next.records.unshift({id:crypto.randomUUID(),assetId:asset.id,name:asset.name,platform:asset.platform,currency:asset.currency,date,type:correcting?'月度修正':previous?'月度更新':'月度起点',before,after:asset.value,amount:Math.round((asset.value-before)*100)/100,note:`转入 ${asset.inflow}；转出 ${asset.outflow}。月度收益独立核算，余额变动不是收益。`});
  if(current){current.value=asset.value;current.date=date;}
 }
 const totals:Record<string,number>={};for(const asset of assets)totals[asset.currency]=(totals[asset.currency]??0)+asset.value;
 next.snapshots=[...next.snapshots.filter(s=>s.date!==date),{date,totals}].sort((a,b)=>a.date.localeCompare(b.date));
 next.initialized=true;
 return next;
}
function approximateRate(gain:number,opening:number,netFlow:number):number|null{
 const denominator=opening+netFlow*.5;
 const rate=denominator>0?gain/denominator:null;
 return rate===null||!Number.isFinite(rate)||rate< -1?null:rate;
}
export function summarizePerformance(rows:PerformanceRow[]){
 rows=rows.filter(row=>row.asset.category!=='现金');
 const sum=(key:'openingCny'|'closingCny'|'netFlowCny'|'gainCny'|'assetGainCny'|'fxGainCny')=>rows.reduce((n,row)=>n+row[key],0);
 const opening=sum('openingCny'),closing=sum('closingCny'),netFlow=sum('netFlowCny'),gain=sum('gainCny');
 return {opening,closing,netFlow,gain,assetGain:sum('assetGainCny'),fxGain:sum('fxGainCny'),returnRate:approximateRate(gain,opening,netFlow)};
}
export function monthlyPerformance(previous:MonthSnapshot|undefined,current:MonthSnapshot):Performance|null{
 if(!previous)return null;
 const rows=current.assets.map(asset=>{
  const prior=previous.assets.find(a=>a.id===asset.id);
  const opening=prior?.value??0,closing=asset.value,{inflow,outflow}=asset;
  const endRate=current.rates[asset.currency],startRate=prior?previous.rates[asset.currency]:endRate;
  if(!endRate||!startRate)throw new Error('月度快照缺少汇率');
  const gain=asset.category==='现金'?0:closing-opening-inflow+outflow,openingCny=opening*startRate,closingCny=closing*endRate,netFlowCny=(inflow-outflow)*endRate;
  const assetGainCny=gain*endRate,fxGainCny=asset.category==='现金'?0:opening*(endRate-startRate);
  return {asset,opening,closing,inflow,outflow,gain,returnRate:approximateRate(gain,opening,inflow-outflow),openingCny,closingCny,netFlowCny,gainCny:assetGainCny+fxGainCny,assetGainCny,fxGainCny};
 });
 const serial=(date:string)=>Number(date.slice(0,4))*12+Number(date.slice(5,7));
 return {startDate:previous.date,endDate:current.date,rows,...summarizePerformance(rows),spansMonths:serial(current.date)-serial(previous.date)>1};
}
