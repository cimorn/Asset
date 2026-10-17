import type {Book,RecordEntry} from './finance.ts';
import {investmentRows,roundMoney} from './investing.ts';
import {recordRate} from './exchange.ts';

export function isCashMovement(record:RecordEntry){return record.category==='现金'&&(['转入','存入','取出','消费','买入扣款','卖出到账','转账转入','转账转出'].includes(record.type)||record.type==='剩余'&&!!record.remainingMode&&record.remainingMode!=='更新市值');}

export function recordDisplay(record:RecordEntry){
 if(record.classificationChange)return {label:'分类调整',caption:(record.previousClassification??'')+' → '+(record.classification??''),value:0,direction:'neutral',signed:false};
 if(record.type==='剩余'){
  if(record.remainingMode&&record.remainingMode!=='更新市值')return {label:'剩余',caption:record.remainingMode,value:Math.abs(record.settlement??record.amount),direction:record.remainingMode==='转入'?'income':'expense',signed:false};
  return {label:'剩余',caption:record.remainingMode??'余额',value:record.after,direction:'neutral',signed:false};
 }
 if(['存入','取出','买入扣款','卖出到账','转账转入','转账转出'].includes(record.type)){
  const income=['存入','卖出到账','转账转入'].includes(record.type);
  return {label:record.type,caption:income?'到账':'支出',value:Math.abs(record.settlement??record.amount),direction:income?'income':'expense',signed:false};
 }
 const gross=record.quantity!==undefined&&record.unitPrice!==undefined?record.quantity*record.unitPrice:undefined;
 if(record.type==='买入')return {label:'买入',caption:'支出',value:Math.abs(record.settlement??record.flowIn??(gross===undefined?record.amount:gross+(record.fee??0))),direction:'expense',signed:false};
 if(['卖出','部分卖出','全部卖出'].includes(record.type))return {label:'卖出',caption:'到账',value:Math.abs(record.settlement??record.flowOut??(gross===undefined?record.amount:gross-(record.fee??0))),direction:'income',signed:false};
 if(['转入','收入','卖出到账'].includes(record.type))return {label:'转入',caption:'转入',value:Math.abs(record.settlement??record.amount),direction:'income',signed:false};
 if(['消费','支出','买入扣款'].includes(record.type))return {label:'消费',caption:'支出',value:Math.abs(record.settlement??record.amount),direction:'expense',signed:false};
 if(['期初余额','新增资产'].includes(record.type))return {label:'更新',caption:record.type==='期初余额'?'期初余额':'初始市值',value:record.after,direction:'neutral',signed:false};
 if(record.type==='移除资产')return {label:'更新',caption:'移除市值',value:record.before,direction:'neutral',signed:false};
 const valuation=['更新市值','更新净值','估值更新','月度估值'].includes(record.type);
 return {label:'更新',caption:valuation?'市值变化':'调整金额',value:record.after-record.before,direction:'neutral',signed:true};
}


export function recordEntries(book:Book){
 const accounts=new Map(investmentRows(book).map(row=>[row.assetId,{invested:row.invested,proceeds:row.proceeds,known:row.known}]));
 return book.records.map((record,index)=>({record,index})).sort((a,b)=>b.record.date.localeCompare(a.record.date)||a.index-b.index).map(({record})=>{
  const display=recordDisplay(record),totals=accounts.get(record.assetId),investment=!!totals;
  const invested=record.invested??totals?.invested,proceeds=record.proceeds??totals?.proceeds;
  const item={record,label:display.label,operationAmount:record.classificationChange||display.label==='更新'||record.remainingMode==='更新市值'?null:Math.abs(display.value),value:record.after,netCost:investment&&totals.known&&invested!==undefined?roundMoney(invested-(proceeds??0)):null,proceeds:investment?proceeds??0:null,exchangeRate:recordRate(book,record)};
  if(totals){if(display.label==='买入')totals.invested=roundMoney(totals.invested-Math.abs(display.value));if(display.label==='卖出')totals.proceeds=roundMoney(totals.proceeds-Math.abs(display.value));}
  return item;
 });
}
