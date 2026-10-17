'use client';
import {useMemo,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {type Action,type Asset,type Book,applyAction,classificationOptions,accountClassification} from '@/lib/finance';
import {valuationDates,hasConfirmedRates} from '@/lib/exchange';
import {ledgerAtDate} from '@/lib/ledger';
import {assetFinancialRows} from '@/lib/capital-accounts';
import {currencyStyle} from '@/lib/currency-theme';
import {Choice} from './finance-forms';
import {money} from './finance-dashboard';

type Props={book:Book;asset:Asset;onSave:(action:Action)=>Promise<boolean>;onClose:()=>void;busy:boolean};
export default function ClassificationForm({book,asset,onSave,onClose,busy}:Props){
 const dates=valuationDates(book,asset.id);
 const [date,setDate]=useState(()=>dates.at(-1)??''),[classification,setClassification]=useState(accountClassification(asset)),[error,setError]=useState('');
 const dated=useMemo(()=>{try{return {book:date?ledgerAtDate(book,date):book,error:''};}catch(error){return {book,error:(error as Error).message};}},[book,date]);
 const selected=dated.book.assets.find(item=>item.id===asset.id),current=selected?accountClassification(selected):accountClassification(asset),nextClassification=classification.trim();
 const cash=selected?.category==='现金';
 const classifications=classificationOptions(book);
 const complete=!!selected&&dates.includes(date)&&hasConfirmedRates(book,date)&&classifications.includes(nextClassification)&&nextClassification.length<=40&&nextClassification!==current&&!dated.error;
 const preview=useMemo(()=>{if(!complete)return {book:null,error:''};try{const next=applyAction(book,{type:'classify',id:asset.id,classification:nextClassification,date});return {book:next.ledgerAuthority?ledgerAtDate(next,date):next,error:''};}catch(error){return {book:null,error:(error as Error).message};}},[book,complete,asset.id,nextClassification,date]);
 const updated=preview.book?.assets.find(item=>item.id===asset.id),row=preview.book?assetFinancialRows(preview.book).find(item=>item.assetId===asset.id):undefined;
 const previewError=dated.error||(!selected&&date?'该日期的资产或现金账户尚未建立':'')||preview.error;
 return <Dialog open onOpenChange={open=>!open&&!busy&&onClose()}><DialogContent className="finance-dialog trade-dialog currency-themed" style={currencyStyle(asset.currency)}><DialogHeader><DialogTitle>调整分类</DialogTitle><DialogDescription>{asset.name} · {asset.platform} · {asset.currency}</DialogDescription></DialogHeader><form onSubmit={async event=>{event.preventDefault();setError('');if(!complete)return setError(previewError||'请选择有效日期和不同的新分类');if(previewError)return setError(previewError);if(await onSave({type:'classify',id:asset.id,classification:nextClassification,date}))onClose();}}>
 <div className="trade-current"><span>当日分类<strong>{current}</strong></span><span>{cash?'当日余额':'当日市值'}<strong>{money(selected?.value??asset.value,asset.currency)}</strong></span></div>
 <div className="field-grid trade-fields"><label className="span-2">调整日期<Choice label="调整日期" value={date} onChange={value=>{setDate(value);setError('');}} options={dates} disabled={busy||!dates.length}/></label><label className="span-2">新分类<Choice label="新分类" value={classification} onChange={value=>{setClassification(value);setError('');}} options={classifications} disabled={busy}/></label></div>
 <p className="trade-help">可选择股市、黄金、虚拟币或现金。调整从所选日期生效，保留历史成本、收益和资金流水；归入现金后不计入总投资。{!dates.length&&'请先到设置与汇率保存汇率。'}</p>
 {updated&&<div className="trade-preview"><span>调整后分类<strong>{accountClassification(updated)}</strong></span><span>调整后{cash?'余额':'市值'}<strong>{money(updated.value,updated.currency)}</strong></span><span>净投入成本<strong>{row?.netInput==null?'—':money(row.netInput,updated.currency)}</strong></span><span>累计收益<strong className={(row?.gain??0)>=0?'positive':'negative'}>{row?.gain==null?'—':money(row.gain,updated.currency)}</strong></span></div>}
 {(error||previewError)&&<p className="form-error" role="alert">{error||previewError}</p>}<div className="form-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy||!complete||!!previewError}>{busy?'保存中…':'调整分类'}</button></div>
 </form></DialogContent></Dialog>;
}
