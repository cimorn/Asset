import type {Book,RecordEntry} from './finance.ts';
import {chronologicalRecords,ledgerInputs,projectLedger} from './ledger.ts';
import {recordDisplay,isCashMovement} from './record-display.ts';
import {classifiedCategory} from './classification.ts';
import {roundMoney} from './investing.ts';

export type RecordEditAction={type:'recordEdit';id:string;expected:RecordEntry[];expectedBefore:{source:number;target?:number};date:string;amount?:number;value?:number;targetAmount?:number;targetValue?:number;classification?:string;note?:string};
function money(value:unknown,label:string){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12)throw new Error(label+'须为 0 至 1 万亿之间的有效数字');return roundMoney(value);}
function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value);}
function selection(book:Book,id:string){const selected=book.records.find(row=>row.id===id);if(!selected)throw new Error('该流水已不存在，请刷新后重试');if(!selected.transferId)return {source:selected,target:undefined};const pair=book.records.filter(row=>row.transferId===selected.transferId),source=pair.find(row=>row.transferLeg==='out'),target=pair.find(row=>row.transferLeg==='in');if(pair.length!==2||!source||!target||source.date!==target.date||source.counterpartyId!==target.assetId||target.counterpartyId!==source.assetId)throw new Error('关联流水不完整，请先核对账本');return {source,target};}
function beforeRecord(book:Book,row:RecordEntry,exclude:Set<string>){const ordered=chronologicalRecords(book.records),index=ordered.findIndex(item=>item.id===row.id);return projectLedger({...book,records:ordered.slice(0,index).filter(item=>!exclude.has(item.id)),rateHistory:book.rateHistory?.filter(point=>point.date<=row.date)});}
function beforeBalances(book:Book,source:RecordEntry,target:RecordEntry|undefined,ids:Set<string>){const value=(row:RecordEntry)=>beforeRecord(book,row,ids).assets.find(asset=>asset.id===row.assetId)?.value??0;return {source:value(source),...(target?{target:value(target)}:{})};}
/** Return displayed values and the canonical inputs used by the optimistic concurrency guard. */
export function recordEditContext(book:Book,id:string){const {source,target}=selection(projectLedger(book),id),inputs=ledgerInputs(book),ids=new Set([source.id,...target?[target.id]:[]]);return {source,target,expectedBefore:beforeBalances(inputs,source,target,ids),expected:[source,...target?[target]:[]].map(row=>inputs.records.find(item=>item.id===row.id)!),before:beforeRecord(inputs,inputs.records.find(row=>row.id===source.id)!,ids)};}
/** Replace existing inputs atomically; all balances and dated gains are replayed by the ledger. */
export function applyRecordEdit(input:Book,action:RecordEditAction,date:string):Book{
 const book=ledgerInputs(input),{source,target}=selection(book,action.id),rows=[source,...target?[target]:[]],ids=new Set(rows.map(row=>row.id));
 if(!Array.isArray(action.expected)||action.expected.length!==rows.length||canonical([...action.expected].sort((a,b)=>a.id.localeCompare(b.id)))!==canonical([...rows].sort((a,b)=>a.id.localeCompare(b.id))))throw new Error('流水已被其他操作修改，请刷新后重新编辑');
 if(!action.expectedBefore||canonical(action.expectedBefore)!==canonical(beforeBalances(book,source,target,ids)))throw new Error('前序流水或操作前余额已改变，请刷新后重新编辑');
 const markerOrder=chronologicalRecords(book.records).filter(row=>row.assetId===source.assetId&&row.classificationChange).map(row=>row.id);
 const firsts=new Map<string,string>();for(const row of chronologicalRecords(book.records))if(!firsts.has(row.assetId))firsts.set(row.assetId,row.id);
 for(const row of rows)row.date=date;
 const ordered=chronologicalRecords(book.records);
 for(const row of rows){if(ordered.find(item=>item.assetId===row.assetId)?.id!==firsts.get(row.assetId))throw new Error('流水日期不能早于账户建立，期初流水不能移到后续流水之后');
  const same=ordered.filter(item=>item.id!==row.id&&item.assetId===row.assetId&&item.date===date);
  const valuation=(item:RecordEntry)=>!item.classificationChange&&!isCashMovement(item)&&recordDisplay(item).direction==='neutral'&&firsts.get(item.assetId)!==item.id;
  if(row.classificationChange&&same.some(item=>item.classificationChange)||valuation(row)&&same.some(valuation))throw new Error('该资产同日已有分类调整或市值更新，请编辑已有流水');
 }
 if(source.classificationChange&&canonical(markerOrder)!==canonical(ordered.filter(row=>row.assetId===source.assetId&&row.classificationChange).map(row=>row.id)))throw new Error('分类调整日期不能跨越其他分类调整，请先核对分类顺序');
 if(!target&&(action.targetAmount!==undefined||action.targetValue!==undefined))throw new Error('该流水没有关联目标账户');
 if(action.classification!==undefined){if(target)throw new Error('关联流水请通过分类调整修改分类');const classification=typeof action.classification==='string'?action.classification.trim():'';if(!classification||classification.length>40)throw new Error('分类不能为空且最多 40 个字符');source.classification=classification;source.category=classifiedCategory(classification,source.category,source.balanceKind);}
 if(action.note!==undefined){if(typeof action.note!=='string'||action.note.length>500)throw new Error('备注最多 500 个字符');for(const row of rows)row.note=action.note;}
 const update=(row:RecordEntry,amount:unknown,value:unknown)=>{
  const before=beforeRecord(book,row,ids).assets.find(asset=>asset.id===row.assetId)?.value??0,display=recordDisplay(row);
  if(row.classificationChange){if(amount!==undefined||value!==undefined)throw new Error('分类调整不修改金额');return;}
  if(isCashMovement(row)){
   const sign=display.direction==='expense'?-1:1;
   const entered=value===undefined?undefined:money(value,'操作后余额');
   const cashAmount=amount===undefined&&entered!==undefined?roundMoney((entered-before)*sign):money(amount??Math.abs(row.settlement??0),'金额');
   if(cashAmount<0)throw new Error('操作后余额与流水方向不一致');
   if(entered!==undefined&&roundMoney(before+sign*cashAmount)!==entered)throw new Error('操作后余额与收支金额不一致');row.settlement=sign*cashAmount;
  }else if(display.direction!=='neutral'){
   row.settlement=(display.direction==='expense'?-1:1)*money(amount??Math.abs(row.settlement??0),'金额');
   if(value!==undefined){const after=money(value,'操作后市值');if(row.positionDelta!==undefined)row.positionDelta=roundMoney(after-before);else row.after=after;}
  }else {if(amount!==undefined)throw new Error('市值更新不记录收支金额');if(value!==undefined)row.after=money(value,'市值或余额');}
 };
 update(source,action.amount,action.value);if(target){update(target,action.targetAmount,action.targetValue);if(!Math.abs(source.settlement??0)||!Math.abs(target.settlement??0))throw new Error('关联转出和转入金额须大于零');target.fundingCurrency=source.currency;target.fundingAmount=Math.abs(source.settlement??0);}
 if(source.classificationChange&&action.classification!==undefined){const markers=ordered.filter(row=>row.assetId===source.assetId&&row.classificationChange);for(let index=1;index<markers.length;index++){markers[index].previousClassification=markers[index-1].classification;if(markers[index].balanceKind)markers[index].previousAccountClassification=markers[index-1].classification;}}
 return projectLedger(book);
}
