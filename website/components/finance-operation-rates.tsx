'use client';
import {useState} from 'react';
import {type Book,type Action,currencyNames} from '@/lib/finance';
import {ratesAt,rateHistory,hasConfirmedRates} from '@/lib/exchange';

export default function OperationRates({book,date,onSave,busy}:{book:Book;date:string;onSave:(action:Action)=>Promise<boolean>;busy:boolean}){
 const inherited=(()=>{try{return ratesAt(book,date);}catch{return book.rates;}})();
 const [rates,setRates]=useState(Object.fromEntries(Object.entries(inherited).map(([c,v])=>[c,String(v)])));
 const confirmed=hasConfirmedRates(book,date),last=rateHistory(book).filter(p=>p.date<=date).at(-1)?.date;
 if(confirmed)return <p className="operation-rates-confirmed">已引用 {date} 的汇率</p>;
 if(!date)return null;
 return <section className="operation-rates" aria-label="本次汇率确认">
  <div><strong>先更新 {date} 的汇率</strong><p>{last?`当前参考 ${last} 的数值，请确认本次汇率后继续。`:'请先填写本次兑人民币汇率。'}</p></div>
  <div className="operation-rates-fields">{Object.entries(currencyNames(book)).filter(([c])=>c!=='CNY').map(([code,name])=><label key={code}>{name} · {code}/CNY<input aria-label={`${code}兑人民币汇率`} type="number" step="any" min="0.00000001" max="1000000" value={rates[code]??''} disabled={busy} onChange={event=>setRates(previous=>({...previous,[code]:event.target.value}))}/></label>)}</div>
  <button type="button" className="button secondary" disabled={busy} onClick={()=>void onSave({type:'rates',date,rates:Object.fromEntries(Object.entries(rates).map(([c,v])=>[c,v.trim()===''?NaN:Number(v)])),source:'手动汇率'})}>保存本次汇率</button>
 </section>;
}
