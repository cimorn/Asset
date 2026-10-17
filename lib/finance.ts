import {applyRecordEdit,type RecordEditAction} from './record-edit.ts';
export {recordEditContext} from './record-edit.ts';
export type {RecordEditAction} from './record-edit.ts';
import {applyAdjustment,type ClassificationAction,type TransferAction} from './asset-adjustments.ts';
import {assetClassification,categoryFromClassification,classifiedCategory,fillClassifications} from './classification.ts';
import {standardAssetCode} from './asset-options.ts';
export {standardAssetCode,assetOptionGroups} from './asset-options.ts';
import {accountClassification,assetAccountKey,ensureCapitalAccounts,changeCapital,type CapitalAccount,type CapitalMovement} from './capital-accounts.ts';
export {accountClassification,capitalAccounts,ensureCapitalAccounts,assetFinancialRows} from './capital-accounts.ts';
export {assetSummary,assetGroupSummaries,classificationSummaries} from './asset-statistics.ts';
import {withLedgerOrder,replaceValuation,ledgerAtDate} from './ledger.ts';
export {projectLedger,ledgerInputs} from './ledger.ts';
export {assetClassification,recordClassification,classificationOptions,defaultClassifications,defaultClassification,fillClassifications,categoryFromClassification} from './classification.ts';
export {recordDisplay,recordEntries} from './record-display.ts';
import {applyMonth,type MonthSnapshot,type MonthAction} from './monthly.ts';
import {exactDate,operationDate,eventRate,setRatePoint,stampRecord,capturePortfolio,latestDate,hasConfirmedRates,type RatePoint} from './exchange.ts';
export {ratesAt,rateHistory,capturePortfolio,stampRecord,latestDate,hasConfirmedRates} from './exchange.ts';
export {captureGains,finalizeFinancialRecords} from './investing.ts';
import {applyTrade,applyPosition,captureGains,finalizeFinancialRecords,investmentRows,units,roundUnits,type TradeAction,type PositionAction,type InvestmentAccount,type GainSnapshot} from './investing.ts';
export {investmentRows} from './investing.ts';
export {monthlyPerformance} from './monthly.ts';
export type Category = '股票'|'基金'|'黄金'|'债券'|'现金'|'其他';
export type Asset = {id:string;name:string;code?:string;platform:string;category:Category;classification?:string;accountClassification?:string;market:string;currency:string;value:number;cost:number|null;proceeds?:number;quantity?:number|null;unitPrice?:number|null;date:string;note:string;icon?:string};
export type RemainingMode='转入'|'转出'|'消费'|'更新市值';
export type RecordEntry = {classificationChange?:boolean;previousClassification?:string;previousAccountClassification?:string;balanceKind?:boolean;transferId?:string;transferLeg?:'out'|'in';counterpartyId?:string;fundingCurrency?:string;fundingAmount?:number;positionDelta?:number;id:string;assetId:string;name:string;code?:string;category?:Category;platform:string;currency:string;date:string;type:string;remainingMode?:RemainingMode;inputType?:'买入'|'卖出';classification?:string;order?:number;before:number;after:number;amount:number;note:string;flowIn?:number;flowOut?:number;realizedGain?:number;quantity?:number;unitPrice?:number;fee?:number;settlement?:number;costBasis?:number;invested?:number;proceeds?:number;gain?:number;exchangeRate?:number;settlementCny?:number;valueCny?:number;investedCny?:number;proceedsCny?:number;gainCny?:number};
export type Snapshot = {date:string;totals:Record<string,number>;investmentTotals?:Record<string,number>;rates?:Record<string,number>};
export type Book = {initialized:boolean;ledgerAuthority?:boolean;assets:Asset[];records:RecordEntry[];snapshots:Snapshot[];rates:Record<string,number>;rateDate:string;rateSource:string;base:string;statisticsStart?:string;rateHistory?:RatePoint[];customCurrencies?:Record<string,string>;months?:MonthSnapshot[];closedAssets?:Asset[];investments?:InvestmentAccount[];capitalBase?:CapitalAccount[];capitalBaseDate?:string;capitalMovements?:CapitalMovement[];capitalAccounts?:CapitalAccount[];gainSnapshots?:GainSnapshot[]};
export const categories:Category[]=['股票','基金','黄金','债券','现金','其他'];
export const currencies:Record<string,string>={CNY:'人民币',USD:'美元',HKD:'港币'};
export function currencyNames(book?:Book){return {...currencies,...book?.customCurrencies};}
export const colors:Record<string,string>={'股票':'#87a5cc','基金':'#a1aece','黄金':'#cbb285','债券':'#8fb7bb','现金':'#9bbdaa','其他':'#b3bdcd'};
export const markets=['A股','港股','美股','全球','其他','不适用'];
export const initialRates={CNY:1,USD:7.1,HKD:0.91};
export function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function monthlyRateDate(value:string){
 const date=/^\d{4}-(0[1-9]|1[0-2])$/.test(value)?value+'-01':value;
 if(!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date))throw new Error('汇率月份无效');
 const parsed=new Date(date+'T00:00:00Z');
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw new Error('汇率日期无效');
 return date.slice(0,7)+'-01';
}
export function emptyBook():Book{return {initialized:false,assets:[],records:[],snapshots:[],rates:{...initialRates},rateDate:'',rateSource:'汇率待设置',base:'CNY'};}
export function convert(value:number,currency:string,base:string,rates:Record<string,number>){if(!Number.isFinite(value)||!rates[currency]||!rates[base])throw new Error('币种缺少有效汇率');return value*rates[currency]/rates[base];}
export function total(assets:Asset[],base:string,rates:Record<string,number>){return assets.reduce((n,a)=>n+convert(a.value,a.currency,base,rates),0);}
export function groups(assets:Asset[],key:'platform'|'category'|'classification'|'currency'|'market',base:string,rates:Record<string,number>){const result:Record<string,{name:string;value:number;count:number;native:number}>=Object.create(null);for(const a of assets){const name=key==='classification'?accountClassification(a):a[key];const g=result[name]??={name,value:0,count:0,native:0};g.value+=convert(a.value,a.currency,base,rates);g.count++;g.native+=a.value;result[name]=g;}return Object.values(result).sort((a,b)=>b.value-a.value);}
export type Action=(RecordEditAction|ClassificationAction|TransferAction|TradeAction|PositionAction|MonthAction|{type:'start'}|{type:'add';assets:Asset[]}|{type:'update';asset:Asset;reason?:string}|{type:'remove';id:string}|{type:'icon';id:string;value?:string}|{type:'cash';id:string;kind:'收入'|'支出'|'转入'|'消费'|'存入'|'取出'|'转账'|'更新市值';targetId?:string;amount?:number;value?:number;note?:string}|{type:'rates';rates:Record<string,number>;date:string;source:string}|{type:'base';base:string}|{type:'currency';code:string;name:string;rate:number})&{date?:string;exchangeRate?:number};
function checkedIcon(value:unknown){if(typeof value!=='string'||value.length>150000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('请上传 PNG、JPG 或 WebP 图片');return value;}
function checkText(value:unknown,label:string,max=100){if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`${label}不能为空且最多 ${max} 个字符`);return value.trim();}
function amount(value:unknown,label:string){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12)throw new Error(`${label}须为 0 至 1 万亿之间的有效数字`);return Math.round(value*100)/100;}
export function validateAsset(raw:unknown,book?:Book):Asset{
 if(!raw||typeof raw!=='object')throw new Error('资产格式无效');const a={...raw as Asset};
 a.classification=checkText(assetClassification(a),'分类',40);a.category=classifiedCategory(a.classification,book?.assets.find(asset=>asset.id===a.id)?.category??a.category,book?.records.some(record=>record.assetId===a.id&&record.type==='剩余'));
 if(!markets.includes(a.market)||!Object.hasOwn(currencyNames(book),a.currency))throw new Error('资产分类、市场或币种无效');
 const quantity=a.category==='现金'||a.quantity==null?null:units(a.quantity,'持仓数量'),unitPrice=a.category==='现金'||a.unitPrice==null?null:units(a.unitPrice,'当前净值');
 if((quantity===null)!==(unitPrice===null))throw new Error('数量和净值须一同填写');
 const cost=a.cost==null?null:amount(a.cost,'成本'),value=quantity!==null&&unitPrice!==null?amount(quantity*unitPrice,'市值'):amount(a.value,'余额');
 if(quantity===0&&cost)throw new Error('空仓成本须为 0');
 return {id:checkText(a.id,'记录编号',80),name:checkText(a.name,'资产名称',80),code:standardAssetCode(a.name,typeof a.code==='string'?a.code.slice(0,30):''),platform:checkText(a.platform,'平台名称',60),category:a.category,market:a.market,currency:a.currency,value,cost,quantity,unitPrice,date:exactDate(a.date??today()),note:typeof a.note==='string'?a.note.slice(0,500):'',...(a.proceeds!==undefined?{proceeds:amount(a.proceeds,'累计卖出到账')}:{}),...(a.icon?{icon:checkedIcon(a.icon)}:{}),...(a.classification!==undefined?{classification:checkText(a.classification,'分类',40)}:{}),...(a.category==='现金'&&a.accountClassification?{accountClassification:checkText(a.accountClassification,'账户归属分类',40)}:{})};
}
export function applyAction(book:Book,raw:unknown):Book{
 const action=raw as Action|undefined;
 if(action?.type==='recordEdit'){
  if(!book.ledgerAuthority)throw new Error('请先读取正式账本');
  const date=operationDate(book,action.date,today(),true);
  if(!hasConfirmedRates(book,date))throw new Error('请选择已保存汇率的操作日期');
  return applyRecordEdit(book,action,date);
 }
 if(action&&(action.type==='transfer'||action.type==='classify')){
  if(!book.ledgerAuthority)throw new Error('请先读取正式账本');
  const date=operationDate(book,action.date,today(),true);
  if(!hasConfirmedRates(book,date))throw new Error('请选择已保存汇率的操作日期');
  return withLedgerOrder(applyAdjustment(book,action,date),book);
 }
 if(book.ledgerAuthority&&action&&['cash','trade','position','add'].includes(action.type)){
  const financial=action as Extract<Action,{type:'cash'|'trade'|'position'|'add'}>;
  const date=operationDate(book,financial.date??(financial.type==='add'?financial.assets?.[0]?.date:undefined)??today(),today(),true);
  if(!hasConfirmedRates(book,date))throw new Error('请选择已保存汇率的操作日期');
  if(financial.type==='cash'&&financial.kind==='更新市值'||financial.type==='trade'&&financial.kind==='value')return withLedgerOrder(applyActionInputs(book,{...financial,date}),book);
  const dated=ledgerAtDate(book,date);
  if(financial.type==='add'){
   if(!Array.isArray(financial.assets)||financial.assets.some(asset=>[...book.assets,...book.closedAssets??[]].some(existing=>existing.id===asset.id)))throw new Error('记录重复或资产格式无效，请重新加载后再试');
  }else if(!dated.assets.some(item=>item.id===financial.id))throw new Error('该日期的资产或现金账户尚未建立');
  const currency=financial.type==='add'?financial.assets[0]?.currency:dated.assets.find(item=>item.id===financial.id)?.currency;
  if(financial.exchangeRate!==undefined&&currency&&financial.exchangeRate!==dated.rates[currency])throw new Error('操作须使用该日期已保存的汇率');
  const updated=applyActionInputs(dated,{...financial,date}),ids=new Set(book.records.map(record=>record.id));
  if(financial.type==='trade'&&financial.kind!=='value'){
   // Older desktop/API callers still get the same paired, replayable input semantics.
   const created=updated.records.filter(record=>!ids.has(record.id)),holding=created.find(record=>record.assetId===financial.id),cash=created.find(record=>record.assetId!==financial.id&&(record.type==='剩余'&&record.remainingMode!==undefined||['卖出到账','买入扣款'].includes(record.type)));
   if(!holding||!cash)throw new Error('交易须同时记录来源和目标账户');
   const buy=financial.kind==='buy',outgoing=buy?cash:holding,incoming=buy?holding:cash,transferId=crypto.randomUUID();
   holding.type=buy?'买入':'卖出';holding.positionDelta=Math.round((holding.after-dated.assets.find(asset=>asset.id===financial.id)!.value)*100)/100;
   cash.type='剩余';cash.balanceKind=true;cash.remainingMode=buy?'转出':'转入';cash.settlement=cash.after-cash.before;
   for(const row of [holding,cash]){const asset=updated.assets.find(item=>item.id===row.assetId)!;row.category=asset.category;row.classification=assetClassification(asset);row.transferId=transferId;row.transferLeg=row===outgoing?'out':'in';row.counterpartyId=row===outgoing?incoming.assetId:outgoing.assetId;}
   incoming.fundingCurrency=outgoing.currency;incoming.fundingAmount=Math.abs(outgoing.settlement!);
  }
  const assets=[...book.assets,...updated.assets.filter(asset=>![...book.assets,...book.closedAssets??[]].some(existing=>existing.id===asset.id))];
  return withLedgerOrder({...book,initialized:updated.initialized,assets,records:[...updated.records.filter(record=>!ids.has(record.id)),...book.records]},book);
 }
 return withLedgerOrder(applyActionInputs(book,raw),book);
}
function applyActionInputs(book:Book,raw:unknown):Book{
 if(!raw||typeof raw!=='object')throw new Error('操作格式无效');const a=raw as Action;
 const selectedDate=a.date??(a.type==='add'?a.assets?.[0]?.date:undefined)??today();
 const valuation=book.ledgerAuthority&&(a.type==='trade'&&a.kind==='value'&&Object.hasOwn(a,'value')||a.type==='cash'&&a.kind==='更新市值');
 const financial=['trade','position','add','cash'].includes(a.type),date=financial?operationDate(book,selectedDate,today(),valuation):exactDate(selectedDate);
 const prepared=fillClassifications(book);
 if(valuation){
  if(!hasConfirmedRates(prepared,date))throw new Error('请先保存该更新日期的汇率，再更新市值');
  const action=a as TradeAction|Extract<Action,{type:'cash'}>,asset=prepared.assets.find(item=>item.id===action.id);
  if(!asset||action.type==='cash'&&asset.category!=='现金'||action.type==='trade'&&asset.category==='现金')throw new Error('请选择对应的资产或现金账户');
  if(action.type==='trade'&&(action.amount??0)!==0)throw new Error('更新市值不记录资金进出');
  return replaceValuation(prepared,action.id,amount(action.value,'市值'),date,typeof action.note==='string'?action.note.slice(0,500):'');
 }
 if(['trade','add','cash','update'].includes(a.type))ensureCapitalAccounts(prepared);
 if(a.type==='trade'||a.type==='cash'){const asset=prepared.assets.find(v=>v.id===a.id);if(asset)eventRate(prepared,asset.currency,date,a.exchangeRate);}
 if(a.type==='add'&&a.exchangeRate!==undefined){const currency=a.assets?.[0]?.currency;if(currency)eventRate(prepared,currency,date,a.exchangeRate);}
 if(a.type==='trade')return applyTrade(prepared,a,date);if(a.type==='position')return applyPosition(prepared,a,date);if(a.type==='month'){const updated=applyMonth(book,a,today());for(const asset of updated.assets){if(asset.category!=='现金'&&asset.quantity!=null){if(asset.quantity===0&&asset.value!==0)throw new Error('空仓资产请先记录买入');asset.unitPrice=asset.quantity?roundUnits(asset.value/asset.quantity):0;}}for(const account of updated.investments??[]){const asset=updated.assets.find(v=>v.id===account.assetId);if(asset){account.value=asset.value;account.unitPrice=asset.unitPrice;}}captureGains(updated,today());return updated;}const b=prepared;let snapshot=false,snapshotDate=date;
 const record=(asset:Asset,before:number,after:number,type:string,note='')=>{b.records.unshift({id:crypto.randomUUID(),assetId:asset.id,name:asset.name,platform:asset.platform,currency:asset.currency,classification:assetClassification(asset),date:asset.date||date,type,before,after,amount:Math.round((after-before)*100)/100,note});};
 if(a.type==='icon'){const asset=b.assets.find(item=>item.id===a.id);if(!asset)throw new Error('该资产已不存在');if(a.value)asset.icon=checkedIcon(a.value);else delete asset.icon;return b;}
 if(a.type==='start'){b.initialized=true;}
 else if(a.type==='add'){
  if(!Array.isArray(a.assets)||a.assets.length<1||a.assets.length>300)throw new Error('每次请录入 1–300 笔资产');
  const additions=a.assets.map(item=>validateAsset({...item,date:a.date??item.date??date},b));const ids=new Set(b.assets.map(v=>v.id));
  for(const item of additions){if(item.date!==date)throw new Error('批量资产请使用同一录入日期');if(ids.has(item.id))throw new Error('记录重复，请重新加载后再试');ids.add(item.id);const bought=item.category!=='现金'&&item.cost!==null;record(item,0,item.value,bought?'买入':'新增资产',item.note);if(bought)Object.assign(b.records[0],{settlement:-item.cost!,flowIn:item.cost,invested:item.cost,proceeds:item.proceeds??0,gain:Math.round((item.value+(item.proceeds??0)-item.cost!)*100)/100});}
  b.assets.push(...additions);for(const item of additions)changeCapital(b,item,item.category==='现金'?item.value:item.cost??item.value,date,b.records.find(row=>row.assetId===item.id)?.id);b.initialized=true;snapshot=true;
 }else if(a.type==='update'){
  const item=validateAsset(a.asset,b);const i=b.assets.findIndex(v=>v.id===item.id);if(i<0)throw new Error('该资产已不存在');
  if(b.ledgerAuthority&&(assetClassification(item)!==assetClassification(b.assets[i])||accountClassification(item)!==accountClassification(b.assets[i])))throw new Error('请使用调整分类并选择生效日期，历史分类不会直接覆盖');
  if(b.assets[i].currency!==item.currency)throw new Error('已有资产不能改币种，请单独添加新币种资产');
  if(assetAccountKey(b.assets[i])!==assetAccountKey(item)){
   const old=b.assets[i],capital=old.category==='现金'?old.value:investmentRows(b).find(row=>row.assetId===old.id)?.netCost??old.cost??old.value;
   changeCapital(b,old,-capital,date);changeCapital(b,item,capital,date);
  }
  if(b.ledgerAuthority){
   
   const changed=['code','name','platform','category','classification'].some(key=>JSON.stringify(item[key as keyof Asset]??null)!==JSON.stringify(b.assets[i][key as keyof Asset]??null));
   if(changed){const latest=b.records.filter(record=>record.assetId===item.id).sort((left,right)=>right.date.localeCompare(left.date)||(right.order??0)-(left.order??0))[0];
    if(!latest)throw new Error('请先为该资产记录买入或更新，再修改信息');
    Object.assign(latest,{code:item.code??'',name:item.name,platform:item.platform,category:item.category,classification:assetClassification(item)});
   }
  }
  const tracked=b.investments?.find(v=>v.assetId===item.id);if(tracked&&((!b.ledgerAuthority&&item.category!==b.assets[i].category)||item.cost!==b.assets[i].cost||item.value!==b.assets[i].value||(item.proceeds??0)!==(b.assets[i].proceeds??0)||(item.quantity??null)!==(b.assets[i].quantity??null)||(item.unitPrice??null)!==(b.assets[i].unitPrice??null)))throw new Error('该资产已开始收益统计，请使用买入、卖出或更新市值；基本信息可单独修改');
  const reason=['估值更新','转入或转出','数据修正'].includes(a.reason??'')?a.reason!:'数据修正';const financialChange=(b.ledgerAuthority?['value','cost','proceeds','quantity','unitPrice']:['value','cost','proceeds','quantity','unitPrice','category']).some(key=>JSON.stringify(item[key as keyof Asset]??null)!==JSON.stringify(b.assets[i][key as keyof Asset]??null));if(financialChange){item.date=date;record(item,b.assets[i].value,item.value,reason,item.note);snapshot=true;}else item.date=b.assets[i].date;b.assets[i]=item;
 }else if(a.type==='remove'){
  const i=b.assets.findIndex(v=>v.id===a.id);if(i<0)throw new Error('该资产已不存在');if(b.investments?.some(v=>v.assetId===a.id)&&b.assets[i].value!==0)throw new Error('请先全部卖出，再移除资产；累计收益将保留');if(b.ledgerAuthority||b.months?.length)b.closedAssets=[...(b.closedAssets??[]).filter(asset=>asset.id!==a.id),{...b.assets[i]}];record(b.assets[i],b.assets[i].value,0,'移除资产','仅从持仓中移除，历史记录保留');b.assets.splice(i,1);snapshot=true;
 }else if(a.type==='cash'){
  const item=b.assets.find(v=>v.id===a.id);if(!item||item.category!=='现金')throw new Error('请选择现金类账户');
  const valuation=a.kind==='更新市值',remainingBalance=a.kind==='消费'&&Object.hasOwn(a,'value'),balance=remainingBalance?amount(a.value,'剩余余额'):undefined;
  if(balance!==undefined&&balance>item.value)throw new Error('剩余余额不能大于当前余额；增加余额请使用转入或更新市值');
  const value=amount(remainingBalance?item.value-balance!:valuation?a.value:a.amount,remainingBalance?'消费差额':valuation?'市值':'收支金额');
  if(remainingBalance&&value===0)throw new Error('剩余余额未减少，无需记录消费');
  if(!['收入','支出','转入','消费','存入','取出','转账','更新市值'].includes(a.kind)||!valuation&&value===0)throw new Error('请输入大于零的收支金额');
  const incoming=['收入','转入','存入'].includes(a.kind),target=a.kind==='转账'?b.assets.find(v=>v.id===a.targetId):undefined;
  if(a.kind==='取出')throw new Error('转出必须选择目标账户，请使用转账');
  if(a.kind==='转账'&&(!target||target.id===item.id||target.category!=='现金'||target.currency!==item.currency))throw new Error('转出必须选择不同的同币种目标账户');
  const after=balance??(valuation?value:Math.round((item.value+(incoming?value:-value))*100)/100);if(after<0||after>1e12)throw new Error('余额不足或金额超出允许范围');
  if(target&&target.value+value>1e12)throw new Error('转入余额超出允许范围');
  const kind=a.kind==='收入'?'转入':a.kind==='支出'?'消费':a.kind==='转账'?'转账转出':a.kind;
  const remaining=valuation||remainingBalance||b.records.some(row=>row.assetId===item.id&&row.type==='剩余');
  item.date=date;record(item,item.value,after,remaining?'剩余':kind,typeof a.note==='string'?a.note.slice(0,500):'');const sourceRecordId=b.records[0].id;item.value=after;
  if(remaining){b.records[0].remainingMode=valuation?'更新市值':incoming?'转入':a.kind==='转账'?'转出':'消费';if(!valuation)b.records[0].settlement=incoming?value:-value;}
  if(!valuation&&a.kind!=='转账')changeCapital(b,item,incoming?value:-value,date,sourceRecordId);
  if(target){const balance=Math.round((target.value+value)*100)/100;target.date=date;record(target,target.value,balance,b.records.some(row=>row.assetId===target.id&&row.type==='剩余')?'剩余':'转账转入');if(b.records[0].type==='剩余')Object.assign(b.records[0],{remainingMode:'转入',settlement:value});target.value=balance;}
  if(target&&assetAccountKey(item)!==assetAccountKey(target)){changeCapital(b,item,-value,date,sourceRecordId);changeCapital(b,target,value,date,b.records[0].id);}
  snapshot=true;
 }else if(a.type==='rates'){
  for(const c of Object.keys(currencyNames(b))){if(!a.rates||typeof a.rates[c]!=='number'||!Number.isFinite(a.rates[c])||a.rates[c]<=0||a.rates[c]>1e6)throw new Error(`${c} 汇率必须大于零且不超过一百万`);}
  if(a.rates.CNY!==1)throw new Error('人民币基准汇率须为 1');
  const rateDate=exactDate(a.date);if(rateDate>today()||(b.statisticsStart&&rateDate<b.statisticsStart))throw new Error('汇率日期不能早于统计起点或晚于今天');setRatePoint(b,Object.fromEntries(Object.keys(currencyNames(b)).map(c=>[c,a.rates[c]])),rateDate,checkText(a.source,'汇率来源',100));snapshot=!!b.assets.length;snapshotDate=latestDate(b)>rateDate?latestDate(b):rateDate;
 }else if(a.type==='currency'){const code=checkText(a.code,'币种代码',3).toUpperCase();if(!/^[A-Z]{3}$/.test(code)||Object.hasOwn(currencyNames(b),code))throw new Error('请使用未添加的三位大写币种代码');if(Object.keys(currencyNames(b)).length>=100)throw new Error('最多支持 100 个币种');const name=checkText(a.name,'币种名称',20);if(typeof a.rate!=='number'||!Number.isFinite(a.rate)||a.rate<=0||a.rate>1e6)throw new Error('汇率须大于零且不超过一百万');b.customCurrencies={...b.customCurrencies,[code]:name};b.rates[code]=a.rate;setRatePoint(b,{...b.rates},date,'手动汇率');snapshot=!!b.assets.length;}else if(a.type==='base'){if(!Object.hasOwn(currencyNames(b),a.base))throw new Error('基准币种无效');b.base=a.base;}
 else throw new Error('不支持的操作');
 if(b.assets.length>2000||b.records.length>20000)throw new Error('账本已达到容量上限，请先导出备份');
 finalizeFinancialRecords(b,book);
 if(snapshot){capturePortfolio(b,snapshotDate);captureGains(b,snapshotDate);}
 return b;
}
export function parseImport(text:string,book?:Book):Asset[]{
 const input=text.replace(/^\uFEFF/,'').trim();if(!input)throw new Error('请先粘贴数据');
 const separator=input.split(/\r?\n/)[0].includes('\t')?'\t':',';
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
 for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===separator&&!quoted){row.push(field.trim());field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(field.trim());if(row.some(v=>v!==''))rows.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw new Error('引号不完整');row.push(field.trim());if(row.some(v=>v!==''))rows.push(row);const legacyUnits=rows[0]?.[9]==='持仓数量',netCostFormat=!legacyUnits&&rows[0]?.[5]==='成本';if(rows[0]?.[0]==='资产名称')rows.shift();
 if(rows.length>300||!rows.length)throw new Error('每次支持 1–300 行');return rows.map((v,i)=>{try{if(v.length<5||v.length>11||v[4]==='')throw new Error('需要 5–10 列且市值或余额必填');const oldFormat=legacyUnits||v.length===11;return validateAsset({id:crypto.randomUUID(),name:v[0],platform:v[1],classification:v[2],category:categoryFromClassification(v[2]),currency:v[3].toUpperCase(),value:Number(v[4]),cost:v[5]?Number(v[5])+(netCostFormat?Number(v[9]||0):0):null,market:v[6]||'不适用',note:v[7]||'',code:v[8]||'',...(oldFormat?{quantity:v[9]?Number(v[9]):null,unitPrice:v[10]?Number(v[10]):null}:{proceeds:v[9]?Number(v[9]):0})},book);}catch(e){throw new Error(`第 ${i+1} 行：${(e as Error).message}`);}});
}
export function csvExport(book:Book){const rows=new Map(investmentRows(book).map(row=>[row.assetId,row]));const safe=(v:unknown)=>{let s=String(v??'');if(typeof v!=='number'&&/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\uFEFF'+[['资产名称','平台','分类','币种','市值','成本','市场','备注','代码','累计卖出到账'],...book.assets.map(a=>[a.name,a.platform,assetClassification(a),a.currency,a.value,rows.get(a.id)?.known?rows.get(a.id)!.netCost:null,a.market,a.note,a.code??'',rows.get(a.id)?.proceeds??''])].map(row=>row.map(safe).join(',')).join('\r\n');}
