'use client';
import AssetIcon from './finance-asset-icon';
import OperationRates from './finance-operation-rates';
import {currencyStyle} from '@/lib/currency-theme';
import {useState} from 'react';
import {ArrowDownLeft,ArrowUpRight,TrendingUp,Wallet,Check} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {type Book,type Asset,type Action,applyAction,today} from '@/lib/finance';
import {accountFor,amountTotals,roundMoney,type TradeAction} from '@/lib/investing';
import {money} from './finance-dashboard';
import {Choice} from './finance-forms';
import {ratesAt,latestDate,hasConfirmedRates} from '@/lib/exchange';
import {accountClassification,assetAccountKey,capitalAccounts} from '@/lib/capital-accounts';
export const decimal=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:8});

export default function TradeForm({book,asset,onSave,onClose,onEdit,busy}:{book:Book;asset:Asset;onSave:(action:Action)=>Promise<boolean>;onClose:()=>void;onEdit:()=>void;busy:boolean}){
 const isCash=asset.category==='现金',account=accountFor(book,asset),totals=amountTotals(book,account),needsCost=!isCash&&(asset.cost===null||account.baseline==='value');
 const [kind,setKind]=useState<TradeAction['kind']|'deposit'|'spend'|'transfer'>('value');
 const [date,setDate]=useState(today());
 const exchangeRate=(()=>{try{return ratesAt(book,date||today())[asset.currency];}catch{return NaN;}})();
 const cash=book.assets.filter(a=>a.category==='现金'&&a.currency===asset.currency),localCash=cash.filter(a=>assetAccountKey(a)===assetAccountKey(asset)),targets=cash.filter(a=>a.id!==asset.id);
 const [opening,setOpening]=useState(''),[targetId,setTargetId]=useState(targets.length===1?targets[0].id:'none');
 const [amount,setAmount]=useState(''),[value,setValue]=useState(String(asset.value)),[cost,setCost]=useState(''),[cashId,setCashId]=useState(localCash.length===1?localCash[0].id:localCash.length===0?'new':'none'),[error,setError]=useState('');
 const selling=kind==='sell'||kind==='sellAll';
 const options=isCash?[{id:'value',name:'更新市值',Icon:TrendingUp},{id:'deposit',name:'转入',Icon:ArrowDownLeft},{id:'transfer',name:'转出',Icon:ArrowUpRight},{id:'spend',name:'消费',Icon:Wallet}]:[{id:'value',name:'更新',Icon:TrendingUp},{id:'buy',name:'买入',Icon:ArrowDownLeft},{id:'sell',name:'卖出',Icon:ArrowUpRight},{id:'sellAll',name:'全部卖出',Icon:Check}];
 function changeKind(selected:string){setKind(selected as typeof kind);setAmount('');setValue(selected==='sellAll'?'0':selected==='sell'?'':String(asset.value));setError('');}
 function action():Action{
  if(isCash)return kind==='value'?{type:'cash',id:asset.id,kind:'更新市值',value:Number(value),date}:{type:'cash',id:asset.id,kind:kind==='deposit'?'存入':kind==='transfer'?'转账':'消费',targetId:kind==='transfer'?targetId:undefined,amount:Number(amount),note:'',date};
  return {type:'trade',id:asset.id,kind:kind as TradeAction['kind'],value:Number(value),...(kind==='value'?{}:{amount:Number(amount)}),...(needsCost?{cost:Number(cost)}:{}),...(kind==='value'?{}:cashId==='new'?{newCash:{balance:Number(opening)}}:{cashId}),note:'',date};
 }
 const complete=(isCash?kind==='value'?!!value.trim():!!amount.trim()&&(kind!=='transfer'||targetId!=='none'):!!value.trim()&&(kind==='value'||!!amount.trim()&&cashId!=='none'&&(cashId!=='new'||!!opening.trim()))&&(!needsCost||!!cost.trim()))&&!!date&&Number.isFinite(exchangeRate)&&exchangeRate>0&&hasConfirmedRates(book,date);
 let previewGain=0,previewCapital=0;let previewCash:Asset|undefined;let preview:Asset|undefined,previewTotals:ReturnType<typeof amountTotals>|undefined,previewError='';
 if(complete)try{const result=applyAction(book,action());preview=result.assets.find(a=>a.id===asset.id);previewCash=isCash?(kind==='transfer'?result.assets.find(a=>a.id===targetId):undefined):cashId==='new'?result.assets.find(a=>a.category==='现金'&&!book.assets.some(old=>old.id===a.id)):result.assets.find(a=>a.id===cashId);if(preview){const updated=preview,key=assetAccountKey(updated),capital=capitalAccounts(result).find(row=>row.key===key);previewCapital=capital?.cost??0;previewGain=roundMoney(result.assets.filter(row=>assetAccountKey(row)===key).reduce((sum,row)=>sum+row.value,0)*(result.rates[updated.currency]??1)-(capital?.costCny??0));if(!isCash)previewTotals=amountTotals(result,accountFor(result,updated));}}catch(e){previewError=(e as Error).message;}
 return <Dialog open onOpenChange={open=>!open&&!busy&&onClose()}><DialogContent className="finance-dialog trade-dialog currency-themed" style={currencyStyle(asset.currency)}><DialogHeader><div className="trade-heading"><AssetIcon asset={asset} className="trade-asset-icon"/><div><DialogTitle>{asset.name}</DialogTitle><DialogDescription>{[asset.code,asset.platform,asset.currency].filter(Boolean).join(' · ')}</DialogDescription></div></div></DialogHeader>
 <form onSubmit={async event=>{event.preventDefault();setError('');if(!complete)return setError('请填写完整');if(previewError)return setError(previewError);if(await onSave(action()))onClose();}}>
 <div className="trade-current"><span>{isCash?'余额':'当前市值'}<strong>{money(asset.value,asset.currency)}</strong></span>{!isCash&&<><span>账户成本<strong>{money(capitalAccounts(book).find(row=>row.key===assetAccountKey(asset))?.cost??0,asset.currency)}</strong></span><span>累计卖出<strong>{money(totals.proceeds,asset.currency)}</strong></span></>}</div>
 <div className="trade-options" style={isCash?{gridTemplateColumns:'repeat(4, 1fr)'}:undefined}>{options.map(({id,name,Icon})=><button type="button" key={id} className={kind===id?'selected':''} onClick={()=>changeKind(id)}><Icon size={18}/><strong>{name}</strong></button>)}</div>
 <div className="field-grid trade-fields">
 <div className="span-2"><OperationRates key={date} book={book} date={date} onSave={onSave} busy={busy}/></div>
 <label>操作日期<input aria-label="操作日期" required type="date" min={latestDate(book)||book.statisticsStart} max={today()} value={date} onChange={e=>setDate(e.target.value)}/></label><label>汇率 · {asset.currency}/CNY<input aria-label="引用汇率" required type="number" min="0.00000001" max="1000000" step="any" readOnly value={Number.isFinite(exchangeRate)?exchangeRate:''}/></label>
 {isCash?kind==='value'?<label className="span-2">当前总余额 · {asset.currency}<input aria-label="剩余市值" autoFocus required type="number" min="0" max="1000000000000" step="0.01" value={value} onChange={e=>setValue(e.target.value)}/></label>:<label className="span-2">{kind==='deposit'?'本次转入金额':kind==='transfer'?'本次转出金额':'本次消费金额'} · {asset.currency}<input aria-label="现金金额" autoFocus required type="number" min="0.01" max="1000000000000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>:<>
 {needsCost&&<label className="span-2">成本 · {asset.currency}<input aria-label="成本" required type="number" min="0" max="1000000000000" step="0.01" value={cost} onChange={e=>setCost(e.target.value)}/></label>}
 {kind!=='value'&&<label className={kind==='sellAll'?'span-2':''}>{selling?'卖出到账金额':'买入投入金额'} · {asset.currency}<input aria-label={selling?'卖出到账金额':'买入投入金额'} autoFocus required type="number" min={selling?'0':'0.01'} max="1000000000000" step="0.01" value={amount} onChange={e=>{setAmount(e.target.value);if(kind==='buy')setValue(String(roundMoney(asset.value+Number(e.target.value))));}}/></label>}
 {kind!=='sellAll'&&<label className={kind==='value'?'span-2':''}>{selling?'卖出后剩余市值':kind==='buy'?'买入后市值':'当前市值'} · {asset.currency}<input aria-label={selling?'卖出后剩余市值':'当前市值'} required type="number" min="0" max="1000000000000" step="0.01" value={value} onChange={e=>setValue(e.target.value)}/></label>}
 {kind!=='value'&&<label className="span-2">{selling?'收款现金账户':'付款现金账户'}<Choice label="现金账户" value={cashId} onChange={setCashId} options={{none:'请选择本账户的现金',...Object.fromEntries(localCash.map(a=>[a.id,`${a.platform} · ${accountClassification(a)} · ${a.name} · ${money(a.value,a.currency)}`])),...(!localCash.length?{new:`新建 ${asset.platform} · ${accountClassification(asset)} · ${asset.currency} 现金账户`}:{})}}/></label>}
 {kind!=='value'&&cashId==='new'&&<label className="span-2">交易前现金余额 · {asset.currency}<input aria-label="交易前现金余额" required type="number" min="0" step="0.01" value={opening} onChange={e=>setOpening(e.target.value)} placeholder="填写交易前实际余额，没有余额填 0"/></label>}
 </>}
 {isCash&&kind==='transfer'&&<label className="span-2">转入账户<Choice label="转入账户" value={targetId} onChange={setTargetId} options={{none:'必须选择同币种目标账户',...Object.fromEntries(targets.map(a=>[a.id,`${a.platform} · ${accountClassification(a)} · ${a.name}`]))}}/></label>}
 </div>
 <p className="trade-help">{isCash?kind==='value'?'填写更新后的总余额，替换原余额；差额计入原分类收益，投入成本不变。':kind==='transfer'?'转出必须选择目标账户；来源成本减少，目标成本增加，总资产和收益不变。':kind==='deposit'?'仅填写本次新增资金，将加到现有余额并增加投入成本，不算收益。':'消费减少余额和账户成本，不算投资亏损。':kind==='value'?'仅更新持仓市值，不改变现金余额或账户成本。':selling?'卖出到账增加本账户现金、减少持仓；账户成本不变。':'买入从本账户现金扣除、增加持仓；账户成本不变。'}</p>
 {preview&&<div className="trade-preview"><span>{isCash?'操作后余额':selling?'剩余市值':'更新后市值'}<strong>{money(preview.value,asset.currency)}</strong></span><span>账户成本<strong>{money(previewCapital,asset.currency)}</strong></span>{previewTotals&&<span>累计卖出<strong>{money(previewTotals.proceeds,asset.currency)}</strong></span>}<span>账户收益 · CNY<strong className={previewGain>=0?'positive':'negative'}>{money(previewGain,'CNY')}</strong></span>{previewCash&&kind!=='value'&&<span className="cash-effect">{previewCash.name} · 操作后余额<strong>{money(previewCash.value,previewCash.currency)}</strong></span>}</div>}
 {(error||previewError)&&<p className="form-error" role="alert">{error||previewError}</p>}
 <div className="form-footer trade-update-footer"><button type="button" className="text-button" disabled={busy} onClick={onEdit}>资产信息</button><div><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy||!complete||!!previewError} className="button primary">{busy?'保存中…':`确认${options.find(option=>option.id===kind)?.name}`}</button></div></div>
 </form></DialogContent></Dialog>;
}
