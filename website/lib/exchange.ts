import type {Book,RecordEntry} from './finance.ts';
import {accountClassification} from './capital-accounts.ts';
export type RatePoint={date:string;rates:Record<string,number>;source:string};
export type RateDraft={date:string;rates:Record<string,string>};
const rounded=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export function exactDate(value:string){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw new Error('日期须为有效的 YYYY-MM-DD');
 return value;
}
export function rateHistory(book:Book):RatePoint[]{
 if(book.rateHistory?.length)return [...book.rateHistory].sort((a,b)=>a.date.localeCompare(b.date));
 const date=book.rateDate||book.statisticsStart||book.assets.map(a=>a.date).sort()[0];
 return date?[{date,rates:{...book.rates},source:book.rateSource}]:[];
}
export function ratesAt(book:Book,date:string){
 const points=rateHistory(book),point=points.filter(p=>p.date<=date).at(-1);
 if(points.length&&!point)throw new Error('该日期之前没有已保存的汇率');
 return {...(point?.rates??book.rates)};
}
export function hasConfirmedRates(book:Book,date:string){
 const point=rateHistory(book).find(p=>p.date===date);
 return !!point&&point.rates.CNY===1&&Object.keys(book.rates).every(code=>Number.isFinite(point.rates[code])&&point.rates[code]>0);
}
export function latestDate(book:Book){return [...book.assets.map(a=>a.date),...book.records.map(r=>r.date),...book.snapshots.map(s=>s.date),book.rateDate,book.statisticsStart??''].filter(Boolean).sort().at(-1)??'';}
export function savedRateDates(book:Book){
 const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return rateHistory(book).map(point=>point.date).filter(date=>date<=current&&(!book.statisticsStart||date>=book.statisticsStart)&&hasConfirmedRates(book,date));
}
export function valuationDates(book:Book,assetId:string){
 const first=book.records.filter(record=>record.assetId===assetId).map(record=>record.date).sort()[0];
 return savedRateDates(book).filter(date=>!first||date>=first);
}
export function operationDate(book:Book,date:string,today:string,allowHistorical=false){
 exactDate(date);if(date>today)throw new Error('操作日期不能晚于今天');
 if(book.statisticsStart&&date<book.statisticsStart)throw new Error('操作日期不能早于统计起点');
 if(!allowHistorical&&date<latestDate(book))throw new Error('请按时间顺序记录，操作日期不能早于最近一次更新');
 return date;
}
export function setRatePoint(book:Book,rates:Record<string,number>,date:string,source:string){
 exactDate(date);if(rates.CNY!==1)throw new Error('人民币基准汇率须为 1');
 for(const c of Object.keys(book.rates))if(typeof rates[c]!=='number'||!Number.isFinite(rates[c])||rates[c]<=0||rates[c]>1e6)throw new Error(`${c} 汇率必须大于零且不超过一百万`);
 const points=rateHistory(book).filter(p=>p.date!==date);points.push({date,rates:{...rates},source});points.sort((a,b)=>a.date.localeCompare(b.date));
 book.rateHistory=points;const latest=points.at(-1)!;book.rates={...latest.rates};book.rateDate=latest.date;book.rateSource=latest.source;
}
export function eventRate(book:Book,currency:string,date:string,value?:number){
 const rates=ratesAt(book,date),rate=value??rates[currency];
 if(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||rate>1e6||(currency==='CNY'&&rate!==1))throw new Error('当次兑人民币汇率无效');
 if(rate!==rates[currency])setRatePoint(book,{...rates,[currency]:rate},date,'手动操作汇率');
 return rate;
}
export function recordRate(book:Book,record:RecordEntry){return record.exchangeRate??ratesAt(book,record.date)[record.currency];}
export function stampRecord(book:Book,record:RecordEntry){
 const rate=recordRate(book,record);record.exchangeRate=rate;record.valueCny=rounded(record.after*rate);
 if(record.settlement===undefined&&['转入','收入','卖出到账','消费','支出','买入扣款','存入','取出','转账转入','转账转出'].includes(record.type))record.settlement=record.after-record.before;
 if(record.settlement!==undefined)record.settlementCny=rounded(record.fundingAmount!==undefined&&record.fundingCurrency?Math.sign(record.settlement)*record.fundingAmount*ratesAt(book,record.date)[record.fundingCurrency]:record.settlement*rate);
}
export function capturePortfolio(book:Book,date:string){
 const totals:Record<string,number>={},investmentTotals:Record<string,number>={};for(const asset of book.assets){totals[asset.currency]=(totals[asset.currency]??0)+asset.value;if(accountClassification(asset)!=='现金')investmentTotals[asset.currency]=(investmentTotals[asset.currency]??0)+asset.value;}
 book.snapshots=[...book.snapshots.filter(s=>s.date!==date),{date,totals,investmentTotals,rates:ratesAt(book,date)}].sort((a,b)=>a.date.localeCompare(b.date));
}
