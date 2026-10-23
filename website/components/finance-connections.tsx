'use client';
import {currencyStyle,currencyTheme} from '@/lib/currency-theme';
import {useEffect,useState} from 'react';
import {Cloud,ExternalLink,Plus,Link2} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {type Book,type Action,currencyNames} from '@/lib/finance';
export function CurrencyManager({book,onSave,busy}:{book:Book;onSave:(a:Action)=>Promise<boolean>;busy:boolean}){
 const [open,setOpen]=useState(false),[code,setCode]=useState(''),[name,setName]=useState(''),[rate,setRate]=useState('');
 return <>
  <section className="panel currency-settings"><div className="panel-heading"><h2>我的币种 <span className="count">{Object.keys(currencyNames(book)).length} 种</span></h2><button type="button" className="button secondary" disabled={busy} onClick={()=>setOpen(true)}><Plus size={15}/>增加币种</button></div><div className="currency-tags">{Object.entries(currencyNames(book)).map(([c,n])=><span key={c} className="currency-themed" style={currencyStyle(c)}><b>{c}</b>{n}</span>)}</div></section>
  <Dialog open={open} onOpenChange={value=>!busy&&setOpen(value)}><DialogContent className="finance-dialog currency-dialog"><DialogHeader><DialogTitle>增加币种</DialogTitle><DialogDescription className="sr-only">填写币种代码、名称和兑人民币汇率</DialogDescription></DialogHeader>
   <form onSubmit={async event=>{event.preventDefault();if(await onSave({type:'currency',code:code.toUpperCase(),name,rate:Number(rate)})){setCode('');setName('');setRate('');setOpen(false);}}}>
    <div className="field-grid"><label>币种代码<input autoFocus required disabled={busy} aria-label="新增币种代码" maxLength={3} minLength={3} pattern="[A-Za-z]{3}" placeholder="EUR" value={code} onChange={event=>setCode(event.target.value.toUpperCase())}/></label><label>币种名称<input required disabled={busy} aria-label="新增币种名称" maxLength={20} placeholder="欧元" value={name} onChange={event=>setName(event.target.value)}/></label><label className="span-2">兑人民币汇率<div className="currency-rate-input"><input required disabled={busy} aria-label="新增币种汇率" type="number" min="0.00000001" max="1000000" step="any" placeholder="8.20" value={rate} onChange={event=>setRate(event.target.value)}/><small>CNY</small></div></label></div>
    <div className="form-footer"><button type="button" className="button secondary" disabled={busy} onClick={()=>setOpen(false)}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy?'保存中…':'增加币种'}</button></div>
   </form>
  </DialogContent></Dialog>
 </>;
}
export type FeishuStatus={desktop?:boolean;configured?:boolean;linked?:boolean;url?:string|null;lastSyncedAt?:string|null;lastPulledAt?:string|null;error?:string;warning?:string;target?:string;dirty?:boolean;syncing?:boolean;conflicts?:string[];source?:string;archivedDrafts?:number;canReprepare?:boolean;canRetrySave?:boolean;instanceId?:string;ledgerId?:string};
export function FeishuConnection({status,busy,onSync}:{status:FeishuStatus;busy:boolean;onSync:(target?:string)=>Promise<boolean>}){
 const [target,setTarget]=useState(status.target??'');
 useEffect(()=>setTarget(status.target??''),[status.target]);
 const stamp=(value?:string|null)=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'—';
 return <><section className="panel feishu-settings"><div className="panel-heading"><div><h2><Cloud size={17}/>财务管理</h2></div><span className={`connection-badge ${status.linked?'connected':''}`}>{status.linked?'已连接':'待连接'}</span></div><div className="connection-body">
  <div className="feishu-connection-facts"><div><small>应用配置</small><strong>{status.configured?'已配置':'未配置'}</strong></div><div><small>最近保存</small><strong>{stamp(status.lastSyncedAt)}</strong></div><div><small>最近读取</small><strong>{stamp(status.lastPulledAt)}</strong></div></div>
  {!status.linked&&<p className="sync-message">读取 NAS 正式账本后可编辑，点击保存或确认更新后直接保存到 NAS。</p>}
  {(status.error||status.warning)&&<p className="sync-message" role="status">{status.error||status.warning}</p>}
  {!status.configured&&<p className="sync-message">请在 NAS 服务端配置数据库连接，再重新启动服务。</p>}
  <div className="sync-footer"><span>{status.canRetrySave?'上次保存待完成':status.dirty?'有未确认输入':status.linked?'已读取NAS':'尚未连接'}</span>{status.url&&<a className="text-button" href={status.url} target="_blank" rel="noreferrer">打开NAS <ExternalLink size={12}/></a>}<button className="button primary" disabled={busy||status.syncing||status.configured===false} onClick={()=>void onSync(target)}><Link2 size={14}/>{busy?'处理中…':status.linked?'读取NAS':'连接并读取'}</button></div>
 </div></section></>;
}
