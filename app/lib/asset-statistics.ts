import {convert,type Asset,type Book} from './finance.ts';
import {assetClassification} from './classification.ts';
import {roundMoney,investmentRows} from './investing.ts';
import {accountClassification,capitalAccounts,assetFinancialRows} from './capital-accounts.ts';

export function assetSummary(assets:Asset[],base:string,rates:Book['rates']){
 let investment=0,cash=0;
 const native:Record<string,number>={};
 for(const asset of assets){
  const value=convert(asset.value,asset.currency,base,rates);
  if(accountClassification(asset)==='现金')cash+=value;else investment+=value;
  native[asset.currency]=(native[asset.currency]??0)+asset.value;
 }
 return {value:roundMoney(investment+cash),investment:roundMoney(investment),cash:roundMoney(cash),count:assets.length,native:Object.fromEntries(Object.entries(native).map(([currency,value])=>[currency,roundMoney(value)]))};
}

type FinancialRow=ReturnType<typeof assetFinancialRows>[number];
function financialSummary(book:Book,base:string,assets:Asset[],financials:Map<string,FinancialRow>){
 const summary=assetSummary(assets,base,book.rates),nativeCosts:Record<string,number|null>={};
 let costCny:number|null=0;
 for(const asset of assets){
  const row=financials.get(asset.id),known=row?.netInputCny!=null&&row.netInput!=null;
  costCny=costCny===null||!known?null:costCny+row.netInputCny!;
  const native=nativeCosts[asset.currency];
  nativeCosts[asset.currency]=native===null||!known?null:roundMoney((native??0)+row.netInput!);
 }
 if(costCny!==null)costCny=roundMoney(costCny);
 const valueCny=assets.reduce((sum,asset)=>sum+asset.value*book.rates[asset.currency],0);
 const gainCny=costCny===null?null:roundMoney(valueCny-costCny);
 return {...summary,costCny,gainCny,nativeCosts,cost:costCny===null?null:roundMoney(convert(costCny,'CNY',base,book.rates)),gain:gainCny===null?null:roundMoney(convert(gainCny,'CNY',base,book.rates))};
}

/** Sum only selected rows using their original funding costs, never today's FX. */
export function assetFinancialSummary(book:Book,base:string,assets=book.assets){
 return financialSummary(book,base,assets,new Map(assetFinancialRows(book).map(row=>[row.assetId,row])));
}

export function assetGroupSummaries(book:Book,base:string,kind:'classification'|'currency'|'platform',assets=book.assets){
 const grouped=new Map<string,Asset[]>();
 const financials=new Map(assetFinancialRows(book).map(row=>[row.assetId,row]));
 for(const asset of assets){
  const name=kind==='classification'?accountClassification(asset):asset[kind];
  const rows=grouped.get(name)??[];rows.push(asset);grouped.set(name,rows);
 }
 return [...grouped].map(([name,rows])=>({name,...financialSummary(book,base,rows,financials)})).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name));
}

export function classificationSummaries(book:Book,base:string){return assetGroupSummaries(book,base,'classification');}

/** Only the user's cash classification is separate; remaining investment balances stay invested. */
export function investmentOverview(book:Book,base:string){
 const summary=assetSummary(book.assets.filter(asset=>accountClassification(asset)!=='现金'),base,book.rates);
 const performance=portfolioPerformance(book,base).investment;
 const total=assetSummary(book.assets,base,book.rates).value;
 const classified=classificationSummaries(book,base).sort((a,b)=>Number(a.name==='现金')-Number(b.name==='现金')).map(group=>({...group,share:total?group.value/total*100:0}));
 return {summary,performance,classified};
}

type Performance={cost:number|null;gain:number|null;invested:number|null;returnRate:number|null};
/** Capital belongs to a platform/classification/currency account, not to each trade. */
export function portfolioPerformance(book:Book,base:string){
 const total:Performance={cost:0,gain:0,invested:0,returnRate:null},investment:Performance={cost:0,gain:0,invested:0,returnRate:null},groups:Record<string,Performance>={};
 function add(name:string,cost:number|null,gain:number|null,invested:number|null){
  const group=groups[name]??={cost:0,gain:0,invested:0,returnRate:null};
  for(const sum of name==='现金'?[group,total]:[group,total,investment]){
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
 for(const sum of [total,investment,...Object.values(groups)]){sum.returnRate=sum.gain!==null&&sum.invested!==null&&sum.invested>0?sum.gain/sum.invested*100:null;if(sum.cost!==null)sum.cost=roundMoney(sum.cost);if(sum.gain!==null)sum.gain=roundMoney(sum.gain);if(sum.invested!==null)sum.invested=roundMoney(sum.invested);}
 return {total,investment,groups};
}
