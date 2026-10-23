'use client';
import {useMemo,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {type Action,type Book,applyAction,classificationOptions,recordDisplay} from '@/lib/finance';
import {recordEditContext} from '@/lib/record-edit';
import {isCashMovement} from '@/lib/record-display';
import {savedRateDates,ratesAt} from '@/lib/exchange';
import {Choice} from './finance-forms';
import {money} from './finance-dashboard';

type Props={book:Book;id:string;busy:boolean;onSave:(action:Action)=>Promise<boolean>;onClose:()=>void};
export default function RecordEditForm({book,id,busy,onSave,onClose}:Props){
 const [original]=useState(()=>recordEditContext(book,id)),{source,target}=original;
 const display=recordDisplay(source),cash=source.category==='现金',movement=isCashMovement(source),remaining=movement&&!target&&(source.remainingMode==='消费'||display.label==='消费');
 const monetary=!source.classificationChange&&display.direction!=='neutral';
 const [date,setDate]=useState(source.date),[classification,setClassification]=useState(source.classification??''),[amount,setAmount]=useState(String(Math.abs(source.settlement??display.value))),[value,setValue]=useState(String(source.after));
 const [targetAmount,setTargetAmount]=useState(String(Math.abs(target?.settlement??0))),[targetValue,setTargetValue]=useState(String(target?.after??0)),[note,setNote]=useState(source.note),[error,setError]=useState('');
 const dates=savedRateDates(book),classes=[...new Set([...classificationOptions(book),source.classification??''].filter(Boolean))];
 const validNumber=(text:string)=>text.trim()!==''&&Number.isFinite(Number(text))&&Number(text)>=0&&Number(text)<=1e12;
 const needsValue=!source.classificationChange&&(!cash||!movement||remaining),needsAmount=monetary&&!remaining;
 const complete=dates.includes(date)&&(!needsValue||validNumber(value))&&(!needsAmount||validNumber(amount))&&(!target||validNumber(targetAmount)&&(target.category==='现金'||validNumber(targetValue)));
 const action:Action={type:'recordEdit',id,expected:original.expected,expectedBefore:original.expectedBefore,date,note,...(!target?{classification}:{}),...(needsAmount?{amount:Number(amount)}:{}),...(needsValue?{value:Number(value)}:{}),...(target?{targetAmount:Number(targetAmount),...(target.category!=='现金'?{targetValue:Number(targetValue)}:{})}:{})};
 const preview=useMemo(()=>{if(!complete)return {book:null,error:''};try{return {book:applyAction(book,action),error:''};}catch(error){return {book:null,error:(error as Error).message};}},[book,complete,date,classification,amount,value,targetAmount,targetValue,note]);
 const changed=preview.book?.records.find(record=>record.id===source.id),changedTarget=target&&preview.book?.records.find(record=>record.id===target.id);
 const rate=(()=>{try{return ratesAt(book,date)[source.currency];}catch{return null;}})();
 return <Dialog open onOpenChange={open=>!open&&!busy&&onClose()}><DialogContent className="finance-dialog trade-dialog"><DialogHeader><DialogTitle>{target?'编辑转账流水':'编辑流水'}</DialogTitle><DialogDescription>{source.name} · {source.platform} · {source.currency}{target?` → ${target.name} · ${target.platform} · ${target.currency}`:` · ${source.classificationChange?'分类调整':remaining?'剩余':display.label}`}</DialogDescription></DialogHeader>
 <form onSubmit={async event=>{event.preventDefault();setError('');if(!complete||preview.error)return setError(preview.error||'请填写完整的有效金额并选择汇率日期');if(await onSave(action))onClose();}}>
 <div className="field-grid trade-fields">
 <label>流水日期<Choice label="流水日期" value={date} onChange={setDate} options={dates} disabled={busy}/></label><label>当日汇率 · {source.currency}/CNY<input aria-label="流水汇率" readOnly value={rate??'—'}/></label>
 {!target&&<label className="span-2">分类<Choice label="流水分类" value={classification} onChange={setClassification} options={classes} disabled={busy}/></label>}
 {needsAmount&&<label className="span-2">{target?(cash?'转出金额':'卖出到账金额'):'交易金额'} · {source.currency}<input aria-label={target?'转出金额':'交易金额'} type="number" min="0" step="0.01" required disabled={busy} value={amount} onChange={event=>setAmount(event.target.value)}/></label>}
 {needsValue&&<label className="span-2">{cash?'剩余余额':target?'来源剩余市值':'本次市值'} · {source.currency}<input aria-label={cash?'剩余余额':'本次市值'} type="number" min="0" step="0.01" required disabled={busy} value={value} onChange={event=>setValue(event.target.value)}/></label>}
 {target&&<><label className="span-2">实际转入金额 · {target.currency}<input aria-label="实际转入金额" type="number" min="0" step="0.01" required disabled={busy} value={targetAmount} onChange={event=>setTargetAmount(event.target.value)}/></label>{target.category!=='现金'&&<label className="span-2">目标转入后市值 · {target.currency}<input aria-label="目标转入后市值" type="number" min="0" step="0.01" required disabled={busy} value={targetValue} onChange={event=>setTargetValue(event.target.value)}/></label>}</>}
 <label className="span-2">备注<textarea aria-label="流水备注" maxLength={500} disabled={busy} value={note} onChange={event=>setNote(event.target.value)}/></label>
 </div><p className="trade-help">{target?'转出和转入会一起修改。':'修改原记录，不新增一笔流水。'}保存后会重新计算后续余额、成本与收益。{remaining?'填写当时剩余余额，系统重新计算对应支出。':''}</p>
 {changed&&<div className="trade-preview"><span>修正后当笔{cash?'余额':'市值'}<strong>{money(changed.after,source.currency)}</strong></span>{changedTarget&&target&&<span>修正后目标{target.category==='现金'?'余额':'市值'}<strong>{money(changedTarget.after,target.currency)}</strong></span>}</div>}
 {(error||preview.error)&&<p className="form-error" role="alert">{error||preview.error}</p>}
 <div className="form-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy||!complete||!!preview.error}>{busy?'保存中…':'保存修改'}</button></div>
 </form></DialogContent></Dialog>;
}
