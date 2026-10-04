import {convert,type Asset,type Book} from './finance.ts';
import {assetClassification} from './classification.ts';
import {roundMoney,investmentRows} from './investing.ts';
import {accountClassification,capitalAccounts} from './capital-accounts.ts';

export function assetSummary(assets:Asset[],base:string,rates:Book['rates']){
 let investment=0,cash=0;
 const native:Record<string,number>={};
 for(const asset of assets){
  const value=convert(asset.value,asset.currency,base,rates);
  if(asset.category==='现金')cash+=value;else investment+=value;
  native[asset.currency]=(native[asset.currency]??0)+asset.value;
 }
 return {value:roundMoney(investment+cash),investment:roundMoney(investment),cash:roundMoney(cash),count:assets.length,native:Object.fromEntries(Object.entries(native).map(([currency,value])=>[currency,roundMoney(value)]))};
}

export function assetGroupSummaries(book:Book,base:string,kind:'classification'|'currency'|'platform',assets=book.assets){
 const grouped=new Map<string,Asset[]>();
 for(const asset of assets){
  const name=kind==='classification'?accountClassification(asset):asset[kind];
  const rows=grouped.get(name)??[];rows.push(asset);grouped.set(name,rows);
 }
 return [...grouped].map(([name,rows])=>({name,...assetSummary(rows,base,book.rates)})).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name));
}

export function classificationSummaries(book:Book,base:string){return assetGroupSummaries(book,base,'classification');}

type Performance={cost:number|null;gain:number|null;invested:number|null;returnRate:number|null};
/** Capital belongs to a platform/classification/currency account, not to each trade. */
export function portfolioPerformance(book:Book,base:string){
 const total:Performance={cost:0,gain:0,invested:0,returnRate:null},groups:Record<string,Performance>={};
 function add(name:string,cost:number|null,gain:number|null,invested:number|null){
  const group=groups[name]??={cost:0,gain:0,invested:0,returnRate:null};
  for(const sum of [group,total]){
   sum.cost=sum.cost===null||cost===null?null:sum.cost+cost;
   sum.gain=sum.gain===null||gain===null?null:sum.gain+gain;
   sum.invested=sum.invested===null||invested===null?null:sum.invested+invested;
  }
 }
 for(const account of capitalAccounts(book)){
  const value=book.assets.filter(asset=>asset.platform===account.platform&&accountClassification(asset)===account.classification&&asset.currency===account.currency).reduce((sum,asset)=>sum+asset.value,0);
  const valueCny=value*book.rates[account.currency];
  add(account.classification,convert(account.costCny,'CNY',base,book.rates),convert(valueCny-account.costCny,'CNY',base,book.rates),convert(account.costCny,'CNY',base,book.rates));
 }
 for(const sum of [total,...Object.values(groups)]){sum.returnRate=sum.gain!==null&&sum.invested!==null&&sum.invested>0?sum.gain/sum.invested*100:null;if(sum.cost!==null)sum.cost=roundMoney(sum.cost);if(sum.gain!==null)sum.gain=roundMoney(sum.gain);if(sum.invested!==null)sum.invested=roundMoney(sum.invested);}
 return {total,groups};
}
