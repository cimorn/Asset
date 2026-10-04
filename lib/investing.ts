import {recordClassification,assetClassification,defaultClassification} from './classification.ts';
import type {Asset,Book} from './finance.ts';
import {ratesAt,recordRate,stampRecord,capturePortfolio,latestDate} from './exchange.ts';
import {accountClassification,assetAccountKey,changeCapital,capitalAccounts} from './capital-accounts.ts';
export type InvestmentAccount={assetId:string;name:string;code:string;platform:string;currency:string;category:string;classification?:string;basis:number;realized:number;value:number;invested?:number;proceeds?:number;quantity?:number|null;unitPrice?:number|null;startedAt:string;baseline:'cost'|'value'};
export type GainCategory='股票'|'黄金'|'基金'|'债券'|'虚拟币';
export type GainSnapshot={date:string;totals:Record<string,number>;categories?:Partial<Record<GainCategory,Record<string,number>>>;rates?:Record<string,number>;cnyTotal?:number;cnyCategories?:Partial<Record<GainCategory,number>>;cnyInvested?:number;cnyInvestedCategories?:Partial<Record<GainCategory,number>>};
export type TradeAction={type:'trade';id:string;kind:'buy'|'sell'|'sellAll'|'value';amount?:number;value?:number;cost?:number;quantity?:number;unitPrice?:number;fee?:number;cashId?:string;newCash?:{balance:number};note?:string;date?:string;exchangeRate?:number};
export type PositionAction={type:'position';id:string;quantity:number;unitPrice:number;cost:number};
export const roundMoney=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export const roundUnits=(n:number)=>Math.round(n*1e8)/1e8;
export function units(value:unknown,label:string){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12)throw new Error(`${label}须为 0 至 1 万亿之间的数字`);return roundUnits(value);}
function money(value:unknown,label:string){return roundMoney(units(value,label));}
export function accountFor(book:Book,asset:Asset):InvestmentAccount{
 const existing=book.investments?.find(a=>a.assetId===asset.id);
 const amountFields=asset.proceeds!==undefined?{invested:asset.cost??existing?.invested??0,proceeds:asset.proceeds}:{};
 const metadata={name:asset.name,code:asset.code??'',platform:asset.platform,currency:asset.currency,category:asset.category,classification:assetClassification(asset)};
 return existing?{...existing,...metadata,value:asset.value,quantity:asset.quantity,unitPrice:asset.unitPrice,...amountFields}:{assetId:asset.id,...metadata,basis:asset.cost??asset.value,realized:0,value:asset.value,quantity:asset.quantity,unitPrice:asset.unitPrice,startedAt:asset.date,baseline:asset.cost===null?'value':'cost',...amountFields};
}
export function amountTotals(book:Book,account:InvestmentAccount){
 if(account.invested!==undefined)return {invested:account.invested,proceeds:account.proceeds??0};
 // Convert older quantity trades without changing their accumulated gain.
 const recovered=book.records.filter(r=>r.assetId===account.assetId&&['卖出','部分卖出','全部卖出'].includes(r.type)).reduce((sum,r)=>sum+(r.settlement??r.flowOut??((r.costBasis??0)+(r.realizedGain??0))),0);
 const proceeds=roundMoney(Math.max(recovered,account.realized-account.basis,0));
 return {invested:roundMoney(account.basis+proceeds-account.realized),proceeds};
}
export function investmentRows(book:Book){
 const rows=book.assets.filter(a=>a.category!=='现金').map(asset=>({...accountFor(book,asset),known:asset.cost!==null||!!book.investments?.some(a=>a.assetId===asset.id)}));
 for(const saved of book.investments??[])if(!book.assets.some(a=>a.id===saved.assetId))rows.push({...saved,known:true});
 return rows.map(row=>{
  const amounts=amountTotals(book,row);let bought=0,sold=0,investedCny=0,proceedsCny=0;
  for(const record of book.records.filter(r=>r.assetId===row.assetId)){
   const buy=record.type==='买入',sell=['卖出','部分卖出','全部卖出'].includes(record.type);if(!buy&&!sell)continue;
   const native=Math.abs(record.settlement??(buy?record.flowIn:record.flowOut)??(record.quantity!==undefined&&record.unitPrice!==undefined?record.quantity*record.unitPrice+(buy?1:-1)*(record.fee??0):record.amount));
   const cny=Math.abs(record.settlementCny??roundMoney(native*recordRate(book,record)));
   if(buy){bought+=native;investedCny+=cny;}else{sold+=native;proceedsCny+=cny;}
  }
  const openingRate=ratesAt(book,row.startedAt)[row.currency];
  investedCny=roundMoney(investedCny+roundUnits(amounts.invested-roundUnits(bought))*openingRate);proceedsCny=roundMoney(proceedsCny+roundUnits(amounts.proceeds-roundUnits(sold))*openingRate);
  const valuationDate=book.assets.find(asset=>asset.id===row.assetId)?.date??book.closedAssets?.find(asset=>asset.id===row.assetId)?.date??row.startedAt;
  const valuationRate=book.ledgerAuthority?ratesAt(book,valuationDate)[row.currency]:book.rates[row.currency];
  const netCost=roundUnits(amounts.invested-amounts.proceeds),netCostCny=roundMoney(investedCny-proceedsCny),valueCny=roundMoney(row.value*valuationRate),gainCny=roundMoney(valueCny-netCostCny);
  return {...row,...amounts,netCost,netCostCny,investedCny,proceedsCny,valueCny,gainCny,unrealized:roundMoney(row.value-row.basis),gain:roundMoney(amounts.proceeds+row.value-amounts.invested),averageCost:row.quantity?row.basis/row.quantity:null};
 });
}
export function finalizeFinancialRecords(book:Book,previous:Book){
 const old=new Set(previous.records.map(r=>r.id)),created=book.records.filter(r=>!old.has(r.id));
 for(const record of created){record.category=record.category??book.assets.find(asset=>asset.id===record.assetId)?.category??book.closedAssets?.find(asset=>asset.id===record.assetId)?.category;record.code=record.code??book.assets.find(asset=>asset.id===record.assetId)?.code??book.closedAssets?.find(asset=>asset.id===record.assetId)?.code??'';record.classification=recordClassification(book,record);stampRecord(book,record);}
 const rows=new Map(investmentRows(book).map(r=>[r.assetId,r]));
 for(const record of created){const row=rows.get(record.assetId);if(row?.known)Object.assign(record,{investedCny:row.investedCny,proceedsCny:row.proceedsCny,gainCny:row.gainCny});}
}
export function gainCategory(classification:string):GainCategory|undefined{
 if(classification==='股市'||classification==='股票')return '股票';
 if(classification==='黄金'||classification==='基金'||classification==='债券'||classification==='虚拟币')return classification;
}
export function gainBreakdown(book:Book){
 const totals:Record<string,number>={},categories:Record<GainCategory,Record<string,number>>={股票:{},黄金:{},基金:{},债券:{},虚拟币:{}};
 let cnyTotal=0,cnyInvested=0;const cnyCategories:Record<GainCategory,number>={股票:0,黄金:0,基金:0,债券:0,虚拟币:0},cnyInvestedCategories:Record<GainCategory,number>={股票:0,黄金:0,基金:0,债券:0,虚拟币:0};
 // Remaining balances carry their manual classification even on a device with no archived accounts.
 if(book.capitalAccounts||book.ledgerAuthority&&book.records.some(record=>record.type==='剩余')){
  for(const account of capitalAccounts(book)){
   const value=book.assets.filter(asset=>asset.platform===account.platform&&accountClassification(asset)===account.classification&&asset.currency===account.currency).reduce((sum,asset)=>sum+asset.value,0);
   const gain=roundMoney(value-account.cost),gainCny=roundMoney(value*(book.rates[account.currency]??1)-account.costCny),category=gainCategory(account.classification);
   totals[account.currency]=roundMoney((totals[account.currency]??0)+gain);
   cnyTotal=roundMoney(cnyTotal+gainCny);cnyInvested=roundMoney(cnyInvested+account.costCny);
   if(category){categories[category][account.currency]=roundMoney((categories[category][account.currency]??0)+gain);cnyCategories[category]=roundMoney(cnyCategories[category]+gainCny);cnyInvestedCategories[category]=roundMoney(cnyInvestedCategories[category]+account.costCny);}
  }
  return {totals,categories,cnyTotal,cnyCategories,cnyInvested,cnyInvestedCategories,rates:{...book.rates}};
 }
 for(const row of investmentRows(book).filter(a=>a.known)){
  totals[row.currency]=roundMoney((totals[row.currency]??0)+row.gain);
  const category=gainCategory(row.classification??defaultClassification(row.category));
  if(category)categories[category][row.currency]=roundMoney((categories[category][row.currency]??0)+row.gain);
  cnyTotal=roundMoney(cnyTotal+row.gainCny);cnyInvested=roundMoney(cnyInvested+row.investedCny);
  if(category){cnyCategories[category]=roundMoney(cnyCategories[category]+row.gainCny);cnyInvestedCategories[category]=roundMoney(cnyInvestedCategories[category]+row.investedCny);}
 }
 return {totals,categories,cnyTotal,cnyCategories,cnyInvested,cnyInvestedCategories,rates:{...book.rates}};
}
/** Percentage of historical gross purchases; selling never shrinks the denominator. */
export function gainReturn(snapshot:GainSnapshot,category:GainCategory):number|null{
 const gain=snapshot.cnyCategories?.[category],invested=snapshot.cnyInvestedCategories?.[category];
 return gain!==undefined&&invested!==undefined&&invested>0?gain/invested*100:null;
}
export function captureGains(book:Book,date:string){
 const snapshotBook=!book.ledgerAuthority&&book.capitalBaseDate&&date<book.capitalBaseDate?{...book,capitalBase:undefined,capitalAccounts:undefined,capitalMovements:undefined}:{...book,capitalMovements:book.capitalMovements?.filter(event=>event.date<=date)};
 book.gainSnapshots=[...(book.gainSnapshots??[]).filter(s=>s.date!==date),{date,...gainBreakdown(snapshotBook)}].sort((a,b)=>a.date.localeCompare(b.date));
}
export function gainHistory(book:Book,fallbackDate:string):GainSnapshot[]{
 const history=[...(book.gainSnapshots??[])].sort((a,b)=>a.date.localeCompare(b.date));
 if(!investmentRows(book).some(row=>row.known))return history;
 const dates=[...history.map(snapshot=>snapshot.date),...book.assets.map(asset=>asset.date),...book.records.map(record=>record.date)].filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
 const date=[...dates,latestDate(book)].filter(Boolean).sort().at(-1)??fallbackDate;
 // The current point is calculable from the ledger; old category gaps stay unknown.
 return [...history.filter(snapshot=>snapshot.date!==date),{date,...gainBreakdown(book)}].filter(s=>!book.statisticsStart||s.date>=book.statisticsStart);
}
function finish(next:Book,asset:Asset,account:InvestmentAccount,date:string,previous:Book){
 account.value=asset.value;account.quantity=asset.quantity;account.unitPrice=asset.unitPrice;asset.date=date;
 next.investments=[...(next.investments??[]).filter(a=>a.assetId!==asset.id),account];
 finalizeFinancialRecords(next,previous);capturePortfolio(next,date);captureGains(next,date);
 if(next.records.length>20000)throw new Error('账本记录已达上限，请导出备份');return next;
}
export function applyPosition(book:Book,action:PositionAction,date:string):Book{
 const next=structuredClone(book),asset=next.assets.find(a=>a.id===action.id);
 if(!asset||asset.category==='现金')throw new Error('请选择投资资产');
 const account=accountFor(next,asset);
 if(asset.quantity!=null&&asset.cost!==null&&account.baseline==='cost')throw new Error('持仓已建立，请使用买入、卖出或更新净值');
 const quantity=units(action.quantity,'持仓数量'),price=units(action.unitPrice,'当前净值'),cost=money(action.cost,'持仓总成本');
 if(quantity===0&&(asset.value!==0||cost!==0))throw new Error('非空持仓的数量须大于 0');
 const before=asset.value;asset.quantity=quantity;asset.unitPrice=price;asset.value=money(quantity*price,'持仓市值');asset.cost=cost;account.basis=cost;account.baseline='cost';
 next.records.unshift({id:crypto.randomUUID(),assetId:asset.id,name:asset.name,platform:asset.platform,currency:asset.currency,date,type:'补录持仓',before,after:asset.value,amount:roundMoney(asset.value-before),quantity,unitPrice:price,note:'',costBasis:cost});
 return finish(next,asset,account,date,book);
}
function settlementCash(book:Book,action:TradeAction,asset:Asset,date:string){
 if(action.kind==='value'){
  if(action.cashId||action.newCash)throw new Error('更新市值不产生现金交易');
  return;
 }
 if(action.newCash){
  if(action.cashId)throw new Error('请选择一个现金账户');
  if(book.assets.length>=2000)throw new Error('账本已达到资产容量上限');
  if(book.assets.some(a=>a.category==='现金'&&assetAccountKey(a)===assetAccountKey(asset)))throw new Error('已有该平台和分类的同币种现金账户，请直接选择');
  const value=money(action.newCash.balance,'交易前现金余额');
  const cash:Asset={id:crypto.randomUUID(),name:`${asset.platform} ${accountClassification(asset)} ${asset.currency}剩余`,platform:asset.platform,currency:asset.currency,category:'现金',classification:accountClassification(asset),market:'不适用',cost:null,value,date,note:''};
  book.assets.push(cash);
  book.records.unshift({id:crypto.randomUUID(),assetId:cash.id,name:cash.name,platform:cash.platform,currency:cash.currency,classification:cash.classification,date,type:'剩余',before:0,after:value,amount:value,note:''});
  changeCapital(book,cash,value,date,book.records[0].id);
  return cash;
 }
 const cash=book.assets.find(a=>a.id===action.cashId);
 if(!cash||cash.category!=='现金'||assetAccountKey(cash)!==assetAccountKey(asset))throw new Error('请选择同平台、同分类、同币种的现金账户');
 return cash;
}
export function applyTrade(book:Book,action:TradeAction,date:string):Book{
 if(Object.hasOwn(action,'value'))return applyAmountTrade(book,action,date);
 const next=structuredClone(book),asset=next.assets.find(a=>a.id===action.id);
 if(!asset||asset.category==='现金')throw new Error('请选择投资资产');
 if(!['buy','sell','sellAll','value'].includes(action.kind))throw new Error('无效投资操作');
 const account=accountFor(next,asset),before=asset.value,price=units(action.unitPrice,'成交净值');
 if(asset.quantity==null||asset.cost===null||account.baseline!=='cost')throw new Error('请先补录持仓数量和成本');
 const holding=units(asset.quantity,'持仓数量'),fee=money(action.fee??0,'手续费');
 let quantity=0,flowIn=0,flowOut=0,realizedDelta=0,soldCost=0;
 if(action.kind==='value'){if(fee!==0)throw new Error('更新净值不收取手续费');}
 else{
  quantity=units(action.quantity,'成交数量');if(quantity<=0)throw new Error('成交数量须大于 0');
  const gross=money(quantity*price,'成交金额');
  if(action.kind==='buy'){
   if(price===0)throw new Error('买入净值须大于 0');
   flowIn=money(gross+fee,'买入支出');account.basis=money(account.basis+flowIn,'持仓成本');asset.quantity=units(holding+quantity,'持仓数量');
  }else{
   if(quantity>holding)throw new Error('卖出数量不能超过当前持仓');
   if(action.kind==='sellAll'&&quantity!==holding)throw new Error('全部卖出的数量须等于当前持仓');
   if(fee>gross)throw new Error('手续费不能超过卖出金额');
   soldCost=quantity===holding?account.basis:roundMoney(account.basis*quantity/holding);
   account.basis=roundMoney(account.basis-soldCost);flowOut=roundMoney(gross-fee);realizedDelta=roundMoney(flowOut-soldCost);account.realized=roundMoney(account.realized+realizedDelta);asset.quantity=roundUnits(holding-quantity);
  }
 }
 const cash=settlementCash(next,action,asset,date);
 if(cash){if(cash.value+flowOut-flowIn<0)throw new Error('所选现金账户余额不足');money(cash.value+flowOut-flowIn,'现金余额');}
 asset.unitPrice=price;asset.value=money(asset.quantity!*price,'持仓市值');asset.cost=account.basis;
 const selling=action.kind==='sell'||action.kind==='sellAll';
 next.records.unshift({id:crypto.randomUUID(),assetId:asset.id,name:asset.name,platform:asset.platform,currency:asset.currency,date,type:action.kind==='buy'?'买入':selling?(asset.quantity===0?'全部卖出':'部分卖出'):'更新净值',before,after:asset.value,amount:roundMoney(asset.value-before),note:action.note?.slice(0,500)??'',flowIn,flowOut,realizedGain:selling?realizedDelta:undefined,quantity:action.kind==='value'?undefined:quantity,unitPrice:price,fee:action.kind==='value'?undefined:fee,settlement:action.kind==='value'?undefined:action.kind==='buy'?-flowIn:flowOut,costBasis:selling?soldCost:undefined});
 if(cash){const prior=cash.value,remaining=next.records.some(record=>record.assetId===cash.id&&record.type==='剩余');cash.value=roundMoney(prior+flowOut-flowIn);cash.date=date;next.records.unshift({id:crypto.randomUUID(),assetId:cash.id,name:cash.name,platform:cash.platform,currency:cash.currency,date,type:remaining?'剩余':selling?'卖出到账':'买入扣款',...(remaining?{remainingMode:selling?'转入':'转出',settlement:flowOut-flowIn}:{}),before:prior,after:cash.value,amount:roundMoney(cash.value-prior),note:action.note?.slice(0,500)??'',flowIn:flowOut,flowOut:flowIn});}
 return finish(next,asset,account,date,book);
}
function applyAmountTrade(book:Book,action:TradeAction,date:string):Book{
 const next=structuredClone(book),asset=next.assets.find(a=>a.id===action.id);
 if(!asset||asset.category==='现金')throw new Error('请选择投资资产');
 if(!['buy','sell','sellAll','value'].includes(action.kind))throw new Error('无效投资操作');
 const account=accountFor(next,asset),before=asset.value,selling=action.kind==='sell'||action.kind==='sellAll';
 if(asset.cost===null||account.baseline==='value'){
  account.basis=money(action.cost,'累计投入成本');account.invested=account.basis;account.proceeds=asset.proceeds??account.proceeds??0;account.baseline='cost';
 }
 const amounts=amountTotals(next,account),after=money(action.value,'更新后市值');
 if(action.kind==='sellAll'&&after!==0)throw new Error('全部卖出后剩余市值须为 0');
 if(selling&&before===0)throw new Error('当前已清仓，不能重复卖出');
 const settlement=action.kind==='value'?0:money(action.amount,selling?'卖出到账金额':'买入投入金额');
 if(action.kind==='buy'&&settlement===0)throw new Error('买入投入金额须大于 0');
 if(action.kind==='value'&&(action.amount??0)!==0)throw new Error('更新市值不记录资金进出');
 account.invested=money(amounts.invested+(action.kind==='buy'?settlement:0),'累计投入成本');
 account.proceeds=money(amounts.proceeds+(selling?settlement:0),'累计卖出到账');
 const cash=settlementCash(next,action,asset,date);
 const cashDelta=action.kind==='buy'?-settlement:selling?settlement:0;
 if(cash&&cash.value+cashDelta<0)throw new Error('所选现金账户余额不足');
 if(cash)money(cash.value+cashDelta,'现金余额');
 asset.value=after;asset.cost=account.invested;asset.proceeds=account.proceeds;asset.quantity=null;asset.unitPrice=null;
 const gain=roundMoney(after+account.proceeds-account.invested);
 next.records.unshift({id:crypto.randomUUID(),assetId:asset.id,name:asset.name,platform:asset.platform,currency:asset.currency,date,type:action.kind==='buy'?'买入':selling?(after===0?'全部卖出':'部分卖出'):'更新市值',before,after,amount:roundMoney(after-before),note:action.note?.slice(0,500)??'',...(action.kind==='value'?{}:{settlement:cashDelta,flowIn:action.kind==='buy'?settlement:0,flowOut:selling?settlement:0}),invested:account.invested,proceeds:account.proceeds,gain});
 if(cash){const prior=cash.value,remaining=next.records.some(record=>record.assetId===cash.id&&record.type==='剩余');cash.value=roundMoney(prior+cashDelta);cash.date=date;next.records.unshift({id:crypto.randomUUID(),assetId:cash.id,name:cash.name,platform:cash.platform,currency:cash.currency,date,type:remaining?'剩余':selling?'卖出到账':'买入扣款',...(remaining?{remainingMode:selling?'转入':'转出',settlement:cashDelta}:{}),before:prior,after:cash.value,amount:cashDelta,note:action.note?.slice(0,500)??'',flowIn:selling?settlement:0,flowOut:action.kind==='buy'?settlement:0});}
 return finish(next,asset,account,date,book);
}
