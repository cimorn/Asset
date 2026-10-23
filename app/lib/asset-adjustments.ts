import type {Asset,Book,RecordEntry} from './finance.ts';
import {accountClassification} from './capital-accounts.ts';
import {assetClassification} from './classification.ts';
import {ledgerAtDate,valuationId} from './ledger.ts';
import {ratesAt} from './exchange.ts';
import {roundMoney} from './investing.ts';

export type ClassificationAction={type:'classify';id:string;classification:string;date:string};
export type TransferAction={type:'transfer';id:string;targetId:string;amount:number;sourceValue?:number;targetAmount?:number;targetValue?:number;date:string;note?:string};
function money(value:unknown,label:string,positive=false){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||positive&&value<=0||value>1e12)throw new Error(label+'无效');
 const result=roundMoney(value);if(positive&&result<=0)throw new Error(label+'须大于零');return result;
}
function row(asset:Asset,date:string):RecordEntry{
 return {id:'',assetId:asset.id,name:asset.name,code:asset.code,platform:asset.platform,currency:asset.currency,category:asset.category,classification:assetClassification(asset),date,type:'',before:asset.value,after:asset.value,amount:0,note:'',...(asset.category==='现金'?{balanceKind:true}:{})};
}
/** Append a metadata change or both sides of a movement without editing earlier inputs. */
export function applyAdjustment(input:Book,action:ClassificationAction|TransferAction,date:string):Book{
 const dated=ledgerAtDate(input,date),source=dated.assets.find(asset=>asset.id===action.id);
 if(!source)throw new Error('该日期的来源资产尚未建立');
 const book=structuredClone(input);
 if(action.type==='classify'){
  const classification=typeof action.classification==='string'?action.classification.trim():'';
  if(!classification||classification.length>40)throw new Error('分类不能为空且最多 40 个字符');
  if(classification===assetClassification(source))throw new Error('分类没有变化');
  const prior=book.records.find(record=>record.assetId===source.id&&record.date===date&&record.classificationChange);
  const record={...row(source,date),id:prior?.id??valuationId(source.id,date).replace('valuation-','classification-'),type:'分类调整',classification,classificationChange:true,previousClassification:prior?.previousClassification??assetClassification(source),...(source.category==='现金'?{previousAccountClassification:prior?.previousAccountClassification??accountClassification(source)}:{}),order:Math.max(0,...book.records.map(record=>record.order??0))+1};
  book.records=[record,...book.records.filter(existing=>existing.id!==record.id)];
 }else{
  const target=dated.assets.find(asset=>asset.id===action.targetId);
  if(!target||target.id===source.id)throw new Error('请选择该日期已存在的其他目标资产或账户');
  const amount=money(action.amount,'转出金额',true),rates=ratesAt(input,date);
  const targetAmount=money(action.targetAmount??roundMoney(amount*rates[source.currency]/rates[target.currency]),'转入金额',true);
  const sourceAfter=source.category==='现金'?roundMoney(source.value-amount):money(action.sourceValue,'来源剩余市值');
  if(sourceAfter<0||sourceAfter>1e12)throw new Error('来源余额不足或市值无效');
  if(source.category!=='现金'&&source.value<=0)throw new Error('来源资产没有可卖出的持仓');
  const targetAfter=target.category==='现金'?money(roundMoney(target.value+targetAmount),'目标余额'):money(action.targetValue??roundMoney(target.value+targetAmount),'目标市值');
  const transferId=crypto.randomUUID(),note=typeof action.note==='string'?action.note.slice(0,500):'';
  const outgoing:RecordEntry={...row(source,date),id:transferId+'-out',transferId,transferLeg:'out',counterpartyId:target.id,type:source.category==='现金'?'剩余':'卖出',...(source.category==='现金'?{remainingMode:'转出'}:{positionDelta:roundMoney(sourceAfter-source.value)}),settlement:source.category==='现金'?-amount:amount,after:sourceAfter,note};
  const incoming:RecordEntry={...row(target,date),id:transferId+'-in',transferId,transferLeg:'in',counterpartyId:source.id,type:target.category==='现金'?'剩余':'买入',...(target.category==='现金'?{remainingMode:'转入'}:{positionDelta:roundMoney(targetAfter-target.value)}),settlement:target.category==='现金'?targetAmount:-targetAmount,fundingCurrency:source.currency,fundingAmount:amount,after:targetAfter,note};
  book.records=[incoming,outgoing,...book.records];
 }
 if(book.records.length>20000)throw new Error('账本记录已达上限，请导出备份');
 return book;
}
