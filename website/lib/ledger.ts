import type {Book,RecordEntry} from './finance.ts';
import {recordDisplay,isCashMovement} from './record-display.ts';
import {roundMoney,roundUnits,captureGains} from './investing.ts';
import {ratesAt,stampRecord,capturePortfolio} from './exchange.ts';
import {fillClassifications,categoryFromClassification,classifiedCategory} from './classification.ts';
import {capitalAccounts} from './capital-accounts.ts';

export function chronologicalRecords(records:RecordEntry[]){
 return records.map((record,index)=>({record,index})).sort((left,right)=>left.record.date.localeCompare(right.record.date)||(left.record.order??-left.index)-(right.record.order??-right.index)).map(item=>item.record);
}
function restoreAccountClassifications(book:Book){
 const markers=chronologicalRecords(book.records).filter(record=>record.classificationChange&&record.balanceKind);
 const seen=new Set<string>();for(const marker of markers){if(seen.has(marker.assetId))continue;seen.add(marker.assetId);const asset=[...book.assets,...book.closedAssets??[]].find(item=>item.id===marker.assetId);if(asset)asset.accountClassification=marker.previousAccountClassification??marker.previousClassification;}
}
export function valuationId(assetId:string,date:string){
 // A shared semantic ID lets concurrent first updates conflict instead of adding two snapshots.
 let hash=BigInt('0x6c62272e07bb014262b821756295c58d');
 for(const character of assetId+'|'+date){hash=BigInt.asUintN(128,(hash^BigInt(character.codePointAt(0)!))*BigInt('0x1000000000000000000013b'));}
 return 'valuation-'+hash.toString(16).padStart(32,'0');
}

/** Reconstruct balances and account cost at the selected date, excluding future inputs. */
export function ledgerAtDate(book:Book,date:string):Book{
 const baseline=ledgerInputs(book);
 return projectLedger({...baseline,records:baseline.records.filter(record=>record.date<=date),rateHistory:book.rateHistory?.filter(point=>point.date<=date),rates:ratesAt(book,date),rateDate:date});
}

/** Rebuild financial results only from transaction inputs, never from asset totals. */
export function projectLedger(input:Book):Book{
 const book=fillClassifications(input);
 restoreAccountClassifications(book);
 for(const record of book.records)if(record.inputType&&['买入','卖出'].includes(record.inputType)){
  record.type=record.category==='现金'?(record.inputType==='买入'?'转入':'消费'):record.inputType;
  if(record.category!=='现金')delete record.inputType;
 }
 const currentRates={...book.rates};
 const latestRates=book.rateHistory?.slice().sort((a,b)=>a.date.localeCompare(b.date)).at(-1)?.rates;
 const ordered=book.records.map((record,index)=>({record,index})).sort((a,b)=>a.record.date.localeCompare(b.record.date)||(a.record.order??-a.index)-(b.record.order??-b.index));
 const referenced=new Set(book.records.map(record=>record.assetId));
 book.assets=book.assets.filter(asset=>referenced.has(asset.id));
 if(book.closedAssets)book.closedAssets=book.closedAssets.filter(asset=>referenced.has(asset.id));
 const assets=new Map([...book.closedAssets??[],...book.assets].map(asset=>[asset.id,asset]));
 for(const {record} of ordered){
  let asset=assets.get(record.assetId);
  if(!asset){asset={id:record.assetId,name:record.name,code:record.code??'',category:record.category??categoryFromClassification(record.classification!),classification:record.classification,platform:record.platform,currency:record.currency,value:0,cost:0,market:'不适用',date:record.date,note:''};assets.set(asset.id,asset);book.assets.push(asset);}
  Object.assign(asset,{name:record.name,code:record.code??'',...(record.category?{category:record.category}:{}),platform:record.platform,currency:record.currency,...(record.classification?{classification:record.classification}:{})});
 }
 for(const asset of assets.values()){asset.value=0;asset.cost=asset.category==='现金'?null:0;asset.proceeds=asset.category==='现金'?undefined:0;asset.quantity=null;asset.unitPrice=null;asset.date=book.statisticsStart??asset.date;}
 book.investments=[];book.snapshots=[];book.gainSnapshots=[];
 const amounts=new Map<string,{invested:number;proceeds:number;investedCny:number;proceedsCny:number;startedAt:string}>();
 const dates=[...new Set([...ordered.map(item=>item.record.date),...(book.rateHistory??[]).map(point=>point.date)])].sort();
 const classifications=new Map<string,string>();
 let cursor=0;
 for(const date of dates){
  for(;cursor<ordered.length&&ordered[cursor].record.date<=date;cursor++){
   const record=ordered[cursor].record,asset=assets.get(record.assetId);
   if(!asset)throw new Error(record.name+' 的流水缺少资产关联');
   // Historical grouping follows inputs available on this date, not later reclassification.
   Object.assign(asset,{name:record.name,code:record.code??'',category:record.category??categoryFromClassification(record.classification!),platform:record.platform,currency:record.currency,classification:record.classification});
   if(record.classificationChange){classifications.set(asset.id,record.classification!);if(asset.category==='现金')asset.accountClassification=record.classification;}
   const effective=classifications.get(asset.id);if(effective){asset.classification=effective;asset.category=classifiedCategory(effective,asset.category,record.balanceKind);}
   const display=recordDisplay(record),amount=display.label==='更新'?0:Math.abs(display.value);
   const rate=ratesAt(book,record.date)[record.currency];
   if(!rate)throw new Error(record.currency+' 在 '+record.date+' 没有生效汇率');
   if(record.classificationChange)record.after=asset.value;
   if(record.positionDelta!==undefined){record.after=roundMoney(asset.value+record.positionDelta);if(record.after<0||record.after>1e12)throw new Error(record.name+' 的剩余持仓不足或超出允许范围');}
   if(isCashMovement(record)){
    record.after=roundMoney(asset.value+(display.direction==='expense'?-amount:amount));
    if(record.after<0||record.after>1e12)throw new Error(record.name+' 的现金余额不足或超出允许范围，请核对流水');
   }
   record.before=asset.value;record.amount=roundMoney(record.after-record.before);record.exchangeRate=rate;
   if(record.classificationChange||display.label==='更新'||display.label==='剩余'&&!isCashMovement(record))delete record.settlement;
   else record.settlement=display.direction==='expense'?-amount:amount;
   stampRecord(book,record);
   asset.value=record.after;asset.date=record.date;if(record.code!==undefined)asset.code=record.code;
   if(asset.category==='现金'){
    for(const key of ['invested','proceeds','gain','investedCny','proceedsCny','gainCny'] as const)delete record[key];
    continue;
   }
   const sums=amounts.get(asset.id)??{invested:0,proceeds:0,investedCny:0,proceedsCny:0,startedAt:record.date};
   if(display.label==='买入'){sums.invested=roundUnits(sums.invested+amount);sums.investedCny=roundMoney(sums.investedCny+Math.abs(record.settlementCny??amount*rate));}
   if(display.label==='卖出'){sums.proceeds=roundUnits(sums.proceeds+amount);sums.proceedsCny=roundMoney(sums.proceedsCny+Math.abs(record.settlementCny??amount*rate));}
   amounts.set(asset.id,sums);asset.cost=sums.invested;asset.proceeds=sums.proceeds;
   Object.assign(record,{invested:sums.invested,proceeds:sums.proceeds,gain:roundMoney(record.after-sums.invested+sums.proceeds),investedCny:sums.investedCny,proceedsCny:sums.proceedsCny,gainCny:roundMoney(record.after*rate-sums.investedCny+sums.proceedsCny)});
  }
  book.investments=[...amounts].map(([assetId,sums])=>{const asset=assets.get(assetId)!;return {assetId,name:asset.name,code:asset.code??'',platform:asset.platform,currency:asset.currency,category:asset.category,classification:asset.classification,basis:roundUnits(sums.invested-sums.proceeds),realized:0,value:asset.value,invested:sums.invested,proceeds:sums.proceeds,quantity:null,unitPrice:null,startedAt:sums.startedAt,baseline:'cost' as const};});
  // Future trades must not enter earlier points' converted cost or proceeds.
  book.records=ordered.slice(0,cursor).map(item=>item.record);
  book.rates=ratesAt(book,date);capturePortfolio(book,date);captureGains(book,date);
 }
 book.rates={...(latestRates??currentRates)};
 book.records=ordered.reverse().map(item=>item.record);
 book.ledgerAuthority=true;
 book.capitalAccounts=capitalAccounts(book);
 return book;
}

export function withLedgerOrder(book:Book,previous:Book){
 const ids=new Set(previous.records.map(record=>record.id));
 let order=Math.max(0,...previous.records.map(record=>record.order??0));
 for(const record of book.records.filter(record=>!ids.has(record.id)).reverse())record.order=++order;
 return book.ledgerAuthority?projectLedger(book):book;
}

/** Valuations are absolute balances; one end-of-day value must not become another trade. */
export function replaceValuation(book:Book,assetId:string,value:number,date:string,note:string){
 const asset=book.assets.find(item=>item.id===assetId);
 if(!asset)throw new Error('该资产已不存在');
 const ordered=chronologicalRecords(book.records).filter(record=>record.assetId===assetId);
 const first=ordered[0];
 if(first&&date<first.date)throw new Error('更新日期不能早于该资产首次流水');
 const historical=ordered.filter(record=>record.date<=date).at(-1);
 const candidates=ordered.filter(record=>record.date===date&&recordDisplay(record).direction==='neutral'&&(
  record.remainingMode==='更新市值'||record!==first&&['更新','更新市值','更新净值','估值更新','月度估值','剩余'].includes(record.type)
  ||record.category!=='现金'&&['更新市值','更新净值','估值更新','月度估值'].includes(record.type)
 ));
 const prior=candidates.at(-1),replaced=new Set(candidates.map(record=>record.id));
 const record:RecordEntry={id:prior?.id??valuationId(assetId,date),assetId,name:historical?.name??asset.name,code:historical?.code??asset.code,platform:historical?.platform??asset.platform,currency:asset.currency,category:historical?.category??asset.category,classification:historical?.classification??asset.classification,date,type:asset.category==='现金'?'剩余':'更新市值',...(asset.category==='现金'?{remainingMode:'更新市值' as const}:{}),before:0,after:value,amount:0,note,order:Math.max(0,...book.records.map(item=>item.order??0))+1};
 book.records=[record,...book.records.filter(item=>!replaced.has(item.id))];
 if(book.records.length>20000)throw new Error('账本记录已达上限，请导出备份');
 return book;
}

/** Exclude projections from three-way merging; concurrent transactions merge by ID. */
export function ledgerInputs(input:Book):Book{
 const book=fillClassifications(input);
 restoreAccountClassifications(book);
 for(const asset of [...book.assets,...book.closedAssets??[]])Object.assign(asset,{code:'',platform:'',currency:'CNY',category:'其他',classification:undefined,value:0,cost:0,proceeds:0,quantity:null,unitPrice:null,date:book.statisticsStart??'2026-09-01'});
 for(const record of book.records){
  const display=recordDisplay(record);
  if(!record.classificationChange&&display.label!=='更新'&&(display.label!=='剩余'||isCashMovement(record)))record.settlement=display.direction==='expense'?-Math.abs(display.value):Math.abs(display.value);
  else delete record.settlement;
  record.type=display.label;record.before=0;record.amount=0;
  if(isCashMovement(record)||record.classificationChange||record.positionDelta!==undefined)record.after=0;
  for(const key of ['invested','proceeds','gain','investedCny','proceedsCny','gainCny','exchangeRate','settlementCny','valueCny','flowIn','flowOut','realizedGain','costBasis','quantity','unitPrice','fee'] as const)delete record[key];
 }
 book.investments=[];book.snapshots=[];book.gainSnapshots=[];book.months=[];delete book.capitalAccounts;book.ledgerAuthority=true;
 return book;
}
