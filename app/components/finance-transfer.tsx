'use client';
import {useMemo,useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {type Action,type Asset,type Book,applyAction,convert,accountClassification} from '@/lib/finance';
import {hasConfirmedRates,ratesAt,valuationDates} from '@/lib/exchange';
import {ledgerAtDate} from '@/lib/ledger';
import {assetFinancialRows} from '@/lib/capital-accounts';
import {roundMoney} from '@/lib/investing';
import {currencyStyle} from '@/lib/currency-theme';
import {Choice} from './finance-forms';
import {money} from './finance-dashboard';
import {assetOptionGroups} from '@/lib/asset-options';

export type TransferDirection='in'|'out'|'all';
type Props={book:Book;asset:Asset;direction?:TransferDirection;initialDate?:string;onSave:(action:Action)=>Promise<boolean>;onClose:()=>void;onBack?:()=>void;busy:boolean};
const validMoney=(value:string)=>value.trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0&&Number(value)<=1e12;
const accountLabel=(asset:Asset)=>`${asset.platform} · ${accountClassification(asset)} · ${asset.name} · ${asset.currency}`;

export default function TransferForm({book,asset,direction='out',initialDate,onSave,onClose,onBack,busy}:Props){
 const incoming=direction==='in',dates=valuationDates(book,asset.id);
 const [date,setDate]=useState(()=>initialDate&&dates.includes(initialDate)?initialDate:dates.at(-1)??'');
 const dated=useMemo(()=>{try{return {book:date?ledgerAtDate(book,date):book,error:''};}catch(error){return {book,error:(error as Error).message};}},[book,date]);
 const candidates=dated.book.assets.filter(item=>item.id!==asset.id);
 const optionGroups=assetOptionGroups(candidates);
 const [otherId,setOtherId]=useState(()=>incoming?(candidates.find(item=>item.category==='现金'&&item.currency===asset.currency&&accountClassification(item)==='现金')??candidates.find(item=>item.category==='现金'&&item.currency===asset.currency)??candidates.find(item=>item.category==='现金'))?.id??'none':'none');
 const source=dated.book.assets.find(item=>item.id===(incoming?otherId:asset.id)),target=dated.book.assets.find(item=>item.id===(incoming?asset.id:otherId));
 const [amount,setAmount]=useState(''),[sourceValue,setSourceValue]=useState(direction==='all'?'0':''),[targetAmount,setTargetAmount]=useState(''),[targetValue,setTargetValue]=useState(''),[note,setNote]=useState(''),[error,setError]=useState('');
 const sourceCash=source?.category==='现金',targetCash=target?.category==='现金';
 const fx=(()=>{try{const rates=ratesAt(book,date);return {rates,converted:source&&target&&validMoney(amount)?roundMoney(convert(Number(amount),source.currency,target.currency,rates)):NaN};}catch{return {rates:{} as Record<string,number>,converted:NaN};}})();
 const received=targetAmount.trim()?Number(targetAmount):fx.converted,targetAfter=targetValue.trim()?Number(targetValue):target?roundMoney(target.value+received):NaN;
 const complete=!!source&&!!target&&source.id!==target.id&&!!date&&dates.includes(date)&&hasConfirmedRates(book,date)&&!dated.error&&validMoney(amount)&&Number(amount)>0&&(sourceCash||validMoney(sourceValue))&&(!targetAmount.trim()||validMoney(targetAmount))&&Number.isFinite(received)&&received>=0&&received<=1e12&&(targetCash||Number.isFinite(targetAfter)&&targetAfter>=0&&targetAfter<=1e12)&&(!targetValue.trim()||validMoney(targetValue))&&Number.isFinite(fx.rates[source.currency])&&fx.rates[source.currency]>0&&Number.isFinite(fx.rates[target.currency])&&fx.rates[target.currency]>0;
 const action=():Action=>({type:'transfer',id:source!.id,targetId:target!.id,amount:Number(amount),...(!sourceCash?{sourceValue:Number(sourceValue)}:{}),...(targetAmount.trim()?{targetAmount:Number(targetAmount)}:{}),...(!targetCash?{targetValue:targetAfter}:{}),date,note});
 const preview=useMemo(()=>{if(!complete)return {book:null,error:''};try{const next=applyAction(book,{type:'transfer',id:source!.id,targetId:target!.id,amount:Number(amount),...(!sourceCash?{sourceValue:Number(sourceValue)}:{}),...(targetAmount.trim()?{targetAmount:Number(targetAmount)}:{}),...(!targetCash?{targetValue:targetAfter}:{}),date,note});return {book:next.ledgerAuthority?ledgerAtDate(next,date):next,error:''};}catch(error){return {book:null,error:(error as Error).message};}},[book,complete,source?.id,target?.id,amount,sourceCash,sourceValue,targetAmount,targetCash,targetAfter,date,note]);
 const previewRows=preview.book?assetFinancialRows(preview.book):[];
 const sourceAfter=preview.book?.assets.find(item=>item.id===source?.id),destinationAfter=preview.book?.assets.find(item=>item.id===target?.id);
 const sourceRow=previewRows.find(item=>item.assetId===source?.id),targetRow=previewRows.find(item=>item.assetId===target?.id);
 const previewError=dated.error||(date&&(!incoming&&!source||incoming&&otherId!=='none'&&!source)?'该日期的来源资产或账户尚未建立':'')||(date&&(incoming&&!target||!incoming&&otherId!=='none'&&!target)?'该日期的目标资产或账户尚未建立':'')||preview.error;
 function changeDate(value:string){setDate(value);setTargetValue('');setError('');}
 function changeOther(value:string){setOtherId(value);setSourceValue(direction==='all'?'0':'');setTargetAmount('');setTargetValue('');setError('');}
 return <Dialog open onOpenChange={open=>!open&&!busy&&onClose()}><DialogContent className="finance-dialog trade-dialog currency-themed" style={currencyStyle(asset.currency)}><DialogHeader><DialogTitle>{!incoming&&asset.category!=='现金'?'卖出并转入':'资金转移'}</DialogTitle><DialogDescription>{asset.name} · {asset.platform} · {asset.currency}</DialogDescription></DialogHeader>
 <form onSubmit={async event=>{event.preventDefault();setError('');if(!complete)return setError('请选择有效的操作日期、来源和目标，并填写完整金额');if(previewError)return setError(previewError);if(await onSave(action()))onClose();}}>
 <div className="trade-current"><span>来源 · {source?.name??'待选择'}<strong>{source?money(source.value,source.currency):'—'}</strong></span><span>目标 · {target?.name??'待选择'}<strong>{target?money(target.value,target.currency):'—'}</strong></span></div>
 <div className="field-grid trade-fields">
 <label className="span-2">操作日期<Choice label="操作日期" value={date} onChange={changeDate} options={dates} disabled={busy||!dates.length}/></label>
 <div className="span-2"><p className="trade-help">选择已保存汇率的日期，余额和市值按该日期计算。{!dates.length&&'请先到设置与汇率保存汇率。'}</p></div>
 {incoming?<><label className="span-2">来源资产／账户<Choice label="来源资产／账户" value={otherId} onChange={changeOther} optionGroups={optionGroups} options={{none:'请选择来源资产／账户',...Object.fromEntries(candidates.map(item=>[item.id,accountLabel(item)]))}} disabled={busy}/></label><label className="span-2">转入资产／账户<input readOnly aria-label="固定转入资产／账户" value={target?accountLabel(target):accountLabel(asset)}/></label></>:<><label className="span-2">来源资产／账户<input readOnly aria-label="固定来源资产／账户" value={source?accountLabel(source):accountLabel(asset)}/></label><label className="span-2">转入资产／账户<Choice label="转入资产／账户" value={otherId} onChange={changeOther} optionGroups={optionGroups} options={{none:'请选择任意已有资产／账户',...Object.fromEntries(candidates.map(item=>[item.id,accountLabel(item)]))}} disabled={busy}/></label></>}
 <label className="span-2">{sourceCash?'本次转出金额':'卖出到账金额'} · {source?.currency??'来源币种'}<input aria-label={sourceCash?'本次转出金额':'卖出到账金额'} autoFocus required disabled={busy||!source} type="number" inputMode="decimal" min="0.01" max="1000000000000" step="0.01" value={amount} onChange={event=>{setAmount(event.target.value);setTargetValue('');setError('');}}/></label>
 {source&&!sourceCash&&<label className="span-2">卖出后剩余市值 · {source.currency}<input aria-label="卖出后剩余市值" required disabled={busy||direction==='all'} readOnly={direction==='all'} type="number" inputMode="decimal" min="0" max="1000000000000" step="0.01" value={sourceValue} onChange={event=>setSourceValue(event.target.value)}/></label>}
 <label className="span-2">实际转入金额 · {target?.currency??'目标币种'}<input aria-label="实际转入金额" disabled={busy||!target} type="number" inputMode="decimal" min="0" max="1000000000000" step="0.01" value={targetAmount} placeholder={Number.isFinite(fx.converted)?String(fx.converted):'按操作日期已保存汇率自动换算'} onChange={event=>{setTargetAmount(event.target.value);setTargetValue('');setError('');}}/><small>{source&&target&&Number.isFinite(fx.rates[source.currency])&&Number.isFinite(fx.rates[target.currency])?`${date} 汇率：1 ${source.currency} = ${(fx.rates[source.currency]/fx.rates[target.currency]).toLocaleString('zh-CN',{maximumFractionDigits:8})} ${target.currency}；留空按汇率换算。`:'选择来源和目标后显示换算金额。'}</small></label>
 {target&&!targetCash&&<label className="span-2">转入后市值 · {target.currency}<input aria-label="转入后市值" required disabled={busy} type="number" inputMode="decimal" min="0" max="1000000000000" step="0.01" value={targetValue.trim()?targetValue:Number.isFinite(targetAfter)?String(targetAfter):''} onChange={event=>setTargetValue(event.target.value)}/><small>默认等于当日市值加实际转入金额，可填写实际转入后的市值。</small></label>}
 <label className="span-2">备注<input aria-label="转移备注" maxLength={500} disabled={busy} value={note} onChange={event=>setNote(event.target.value)} placeholder="可选"/></label>
 </div>
 <p className="trade-help">支持跨平台、分类和币种转移；来源减少与目标增加会一起保存。实际入账可能因换汇或手续费产生差额，人民币收益预览会反映这些差额。现金账户自动扣减余额，投资资产按填写的剩余市值更新。</p>
 {sourceAfter&&destinationAfter&&<div className="trade-preview"><span>来源 · 操作后{sourceCash?'余额':'市值'}<strong>{money(sourceAfter.value,sourceAfter.currency)}</strong></span><span>目标 · 操作后{targetCash?'余额':'市值'}<strong>{money(destinationAfter.value,destinationAfter.currency)}</strong></span><span>来源 · 净投入成本 · CNY<strong>{sourceRow?.netInputCny==null?'—':money(sourceRow.netInputCny,'CNY')}</strong></span><span>目标 · 净投入成本 · CNY<strong>{targetRow?.netInputCny==null?'—':money(targetRow.netInputCny,'CNY')}</strong></span><span>来源 · 累计收益 · CNY<strong className={(sourceRow?.gainCny??0)>=0?'positive':'negative'}>{sourceRow?.gainCny==null?'—':money(sourceRow.gainCny,'CNY')}</strong></span><span>目标 · 累计收益 · CNY<strong className={(targetRow?.gainCny??0)>=0?'positive':'negative'}>{targetRow?.gainCny==null?'—':money(targetRow.gainCny,'CNY')}</strong></span></div>}
 {(error||previewError)&&<p className="form-error" role="alert">{error||previewError}</p>}
 <div className="form-footer trade-update-footer">{onBack?<button type="button" className="text-button" disabled={busy} onClick={onBack}><ArrowLeft size={14}/>返回</button>:<span/>}<div><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy||!complete||!!previewError}>{busy?'保存中…':'确认转移'}</button></div></div>
 </form></DialogContent></Dialog>;
}
