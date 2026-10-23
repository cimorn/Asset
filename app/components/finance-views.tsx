'use client';
import AssetIcon from './finance-asset-icon';
import {AssetLedgerTable,GroupedAssetDetails} from './finance-asset-list';
import {currencyStyle,currencyTheme} from '@/lib/currency-theme';
import {useState,useEffect,useMemo} from 'react';
import {assetUpdateHistory,assetsForUpdateStatus,type UpdateStatus} from '@/lib/asset-update-dates';
import {Search,Plus,Building2,Globe2,Wallet,Download,History,Layers} from 'lucide-react';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell} from '@/components/ui/table';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Pagination,PaginationContent,PaginationItem,PaginationLink} from '@/components/ui/pagination';
import {type Book,type Asset,type Action,groups,total,convert,colors,currencies,currencyNames,accountClassification,classificationOptions,today} from '@/lib/finance';
import {Choice} from './finance-forms';
import {assetAccountKey,capitalAccounts} from '@/lib/capital-accounts';
import {exactDate,ratesAt,rateHistory,type RateDraft} from '@/lib/exchange';
import {money,amountText} from './finance-dashboard';
import {CurrencyManager,FeishuConnection} from './finance-connections';
import type {FeishuStatus} from './finance-connections';
export function AssetView({book,base,filter,updateFilter={date:'',status:'all'},onClearUpdate,onEdit,onUpdate,onIcon,onClassify,hidden,showSummary=true}:{book:Book;base:string;filter:{platform?:string;currency?:string};updateFilter?:{date:string;status:UpdateStatus};onClearUpdate?:()=>void;onEdit:(a:Asset)=>void;onUpdate:(a:Asset)=>void;onIcon:(a:Asset)=>void;onClassify?:(a:Asset)=>void;hidden:boolean;showSummary?:boolean}){
 const [query,setQuery]=useState(''),[category,setCategory]=useState('all'),[platform,setPlatform]=useState(filter.platform??'all'),[currency,setCurrency]=useState(filter.currency??'all'),[group,setGroup]=useState('none'),[sort,setSort]=useState('value'),[page,setPage]=useState(1);
 const {date:updateDate,status:updateStatus}=updateFilter;
 const scoped=useMemo(()=>book.assets.filter(a=>(!query||`${a.name} ${a.code??''} ${a.platform} ${a.note}`.toLowerCase().includes(query.toLowerCase()))&&(category==='all'||accountClassification(a)===category)&&(platform==='all'||a.platform===platform)&&(currency==='all'||a.currency===currency)),[book.assets,query,category,platform,currency]);
 const history=useMemo(()=>assetUpdateHistory(book,scoped),[book,scoped]);
 const checkDate=history.dates.includes(updateDate)?updateDate:history.dates[0]??'';
 const visible=assetsForUpdateStatus(scoped,history,checkDate,updateStatus).slice().sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh'):sort==='date'?b.date.localeCompare(a.date):convert(b.value,b.currency,base,book.rates)-convert(a.value,a.currency,base,book.rates));
 const p=Math.min(page,Math.max(1,Math.ceil(visible.length/20)));const shown=visible.slice((p-1)*20,p*20),sum=total(visible,base,book.rates),linked=new Set(visible.map(assetAccountKey)),linkedAccounts=capitalAccounts(book).filter(account=>linked.has(account.key)),profit=linkedAccounts.reduce((total,account)=>total+book.assets.filter(asset=>assetAccountKey(asset)===account.key).reduce((value,asset)=>value+asset.value,0)*(book.rates[account.currency]??1)-account.costCny,0);const fmt=(n:number,c=base)=>hidden?'••••••':money(n,c);
 const numeric=(value:number)=>hidden?'••••••':amountText(value);

 return <>{showSummary&&<div className="view-summary"><div><small>筛选内资产总额</small><strong>{fmt(sum)}</strong></div><div><small>资产笔数</small><strong>{visible.length}<em>笔</em></strong></div><div><small>关联账户收益 · CNY</small><strong className={profit>=0?'positive':'negative'}>{linkedAccounts.length?fmt(profit,'CNY'):'—'}</strong></div></div>}<section className="panel"><div className="asset-controls"><div className="asset-toolbar"><div className="search-field"><Search size={15}/><input aria-label="搜索资产" placeholder="搜索名称、代码、平台或备注" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></div><Choice label="筛选资产分类" value={category} onChange={setCategory} options={{all:'全部分类',...Object.fromEntries(classificationOptions(book).map(c=>[c,c]))}}/><Choice label="筛选平台" value={platform} onChange={setPlatform} options={{all:'全部平台',...Object.fromEntries([...new Set(book.assets.map(a=>a.platform))].map(c=>[c,c]))}}/><Choice label="筛选币种" value={currency} onChange={setCurrency} options={{all:'全部币种',...Object.fromEntries(Object.keys(currencyNames(book)).map(c=>[c,c]))}}/>{(query||category!=='all'||platform!=='all'||currency!=='all'||updateStatus!=='all')&&<button className="text-button" onClick={()=>{setQuery('');setCategory('all');setPlatform('all');setCurrency('all');onClearUpdate?.();setPage(1);}}>清除筛选</button>}</div><div className="group-toolbar"><Tabs value={group} onValueChange={setGroup}><TabsList><TabsTrigger value="none">明细</TabsTrigger><TabsTrigger value="platform">按平台</TabsTrigger><TabsTrigger value="classification">按分类</TabsTrigger><TabsTrigger value="currency">按币种</TabsTrigger></TabsList></Tabs><Choice label="排序" value={sort} onChange={setSort} options={{value:'金额从高到低',name:'按名称',date:'最近更新'}}/></div></div>{group==='none'?<><AssetLedgerTable assets={shown} book={book} base={base} hidden={hidden} onEdit={onEdit} onUpdate={onUpdate} onIcon={onIcon} onClassify={onClassify}/>{visible.length===0&&<div className="empty-inline"><Wallet/><p>{book.assets.length?(updateStatus==='pending'?'该日期没有待更新的匹配资产':'没有匹配的资产'):'还没有资产，点击右上角添加'}</p></div>}<div className="table-footer"><span>共 {visible.length} 笔 · 第 {p} / {Math.max(1,Math.ceil(visible.length/20))} 页</span><Pagination><PaginationContent><PaginationItem><PaginationLink onClick={()=>setPage(Math.max(1,p-1))} aria-disabled={p===1}>‹</PaginationLink></PaginationItem><PaginationItem><PaginationLink isActive>{p}</PaginationLink></PaginationItem><PaginationItem><PaginationLink onClick={()=>setPage(Math.min(Math.ceil(visible.length/20),p+1))} aria-disabled={p*20>=visible.length}>›</PaginationLink></PaginationItem></PaginationContent></Pagination></div></>:<GroupedAssetDetails kind={group as 'platform'|'classification'|'currency'} assets={visible} book={book} base={base} hidden={hidden} onEdit={onEdit} onUpdate={onUpdate} onIcon={onIcon} onClassify={onClassify}/>}</section></>;
}
export function GroupView({book,base,kind,onOpen,hidden}:{book:Book;base:string;kind:'platform'|'currency';onOpen:(name:string)=>void;hidden:boolean}){
 const data=groups(book.assets,kind,base,book.rates),sum=total(book.assets,base,book.rates);
 const numeric=(value:number)=>hidden?'••••••':amountText(value);
 return <div className={`group-cards overview-groups ${kind}-groups`}>
  {data.map(g=><button type="button" className={`panel group-card ${kind==='currency'?'currency-themed':''}`} style={kind==='currency'?currencyStyle(g.name):undefined} key={g.name} onClick={()=>onOpen(g.name)}>
   <div className="group-card-top">{kind==='currency'?<span className="currency-code">{g.name}</span>:<AssetIcon asset={{name:g.name,platform:g.name,category:'现金'}}/>}<div><h2>{kind==='currency'?currencyNames(book)[g.name]:g.name}</h2><p>{g.count} 笔资产</p></div></div>
   <div className="group-card-value">{numeric(kind==='currency'?g.native:g.value)}</div>
   <p className="muted">{kind==='currency'?`折合 ${base} ${numeric(g.value)}`:[...new Set(book.assets.filter(a=>a.platform===g.name).map(a=>a.currency))].join(' · ')}</p>
   <div className="group-card-foot"><span>占比 {sum?(g.value/sum*100).toFixed(1):'0.0'}%</span><span>查看资产</span></div>
  </button>)}
  {!data.length&&<div className="panel empty-inline"><Wallet/><p>暂无{kind==='currency'?'币种':'平台'}数据</p></div>}
 </div>;
}
export {default as RecordView} from './finance-records';
export function SettingsView({book,onSave,busy,onBackup,sync,onSync,draft,onDraftChange}:{book:Book;onSave:(a:Action)=>Promise<boolean>;busy:boolean;onBackup:()=>void;sync:FeishuStatus;onSync:(target?:string)=>Promise<boolean>;draft:RateDraft|null;onDraftChange:(draft:RateDraft)=>void}){
 const [selectedDate,setSelectedDate]=useState(draft?.date??today()),[error,setError]=useState('');
 useEffect(()=>{if(draft)setSelectedDate(draft.date);},[draft?.date]);
 const rateDate=draft?.date??selectedDate;
 const inherited=(()=>{try{return ratesAt(book,rateDate);}catch{return book.rates;}})();
 const rates=draft?.rates??Object.fromEntries(Object.entries(inherited).map(([c,v])=>[c,String(v)]));
 const changed=!!draft;
 async function saveRates(){
  setError('');let date:string;try{date=exactDate(rateDate);}catch{setError('请选择有效日期');return false;}
  const saved=await onSave({type:'rates',rates:Object.fromEntries(Object.entries(rates).map(([c,v])=>[c,Number(v)])),date,source:'手动汇率'});
  return saved;
 }
 return <div className="settings-stack">
  <section className="panel monthly-exchange">
   <form onSubmit={async e=>{
    e.preventDefault();setError('');
    await saveRates();
   }}>
    <div className="panel-heading"><div><h2>汇率 <span className="rate-base-label">人民币 · CNY</span></h2><p>{changed?`汇率输入已保留 · ${rateDate} · 待确认保存`:book.rateDate?`最近保存 · ${book.rateDate}`:'尚未保存'}</p></div><label className="rate-month">生效日期<input aria-label="汇率生效日期" type="date" required min={book.statisticsStart} max={today()} value={rateDate} disabled={busy} onChange={e=>{const date=e.target.value;setSelectedDate(date);let next=book.rates;try{next=ratesAt(book,date);}catch{}onDraftChange({date,rates:draft?.rates??Object.fromEntries(Object.entries(next).map(([c,v])=>[c,String(v)]))});}}/></label></div>
    <div className="rates-grid">{Object.entries(currencyNames(book)).map(([c,name])=><label key={c} className="currency-themed" style={currencyStyle(c)}><span><strong>1 {c}</strong>{name}</span><div><input aria-label={`${c}兑人民币汇率`} type="number" step="any" min="0.00000001" required max="1000000" disabled={c==='CNY'||busy} value={rates[c]??''} onChange={e=>onDraftChange({date:rateDate,rates:{...rates,[c]:e.target.value}})}/><small>CNY</small></div></label>)}</div>
    {error&&<p className="form-error padded" role="alert">{error}</p>}
    <div className="form-footer padded"><button type="submit" disabled={busy} className="button primary">保存汇率</button></div>
   </form>
  </section>
  <section className="panel"><div className="panel-heading"><h2>汇率记录</h2>{book.statisticsStart&&<span className="muted">统计起点 {book.statisticsStart}</span>}</div><Table className="asset-table"><TableHeader><TableRow><TableHead>生效日期</TableHead>{Object.keys(currencyNames(book)).filter(c=>c!=='CNY').map(c=><TableHead key={c}>{c}/CNY</TableHead>)}</TableRow></TableHeader><TableBody>{rateHistory(book).slice().reverse().map(point=><TableRow key={point.date}><TableCell>{point.date}</TableCell>{Object.keys(currencyNames(book)).filter(c=>c!=='CNY').map(c=><TableCell key={c}>{point.rates[c]??'—'}</TableCell>)}</TableRow>)}</TableBody></Table></section>
  <CurrencyManager book={book} onSave={onSave} busy={busy}/>
  <FeishuConnection status={{...sync,dirty:sync.dirty||changed}} busy={busy} onSync={onSync}/>
  <section className="panel"><div className="panel-heading"><h2>账本备份</h2><button className="button secondary" onClick={onBackup}><Download size={14}/>下载备份</button></div></section>
 </div>;
}
