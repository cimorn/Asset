'use client';
import {useState} from 'react';
import {Search,Wallet,Layers} from 'lucide-react';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell} from '@/components/ui/table';
import {type Asset,type Book,convert,groups,currencyNames,assetClassification,accountClassification,classificationOptions,assetGroupSummaries,assetSummary} from '@/lib/finance';
import {currencyStyle} from '@/lib/currency-theme';
import AssetIcon from './finance-asset-icon';
import {amountText,money} from './finance-dashboard';
import {assetFinancialRows} from '@/lib/capital-accounts';
import {Choice} from './finance-forms';

type AssetActions={onEdit?:(asset:Asset)=>void;onUpdate?:(asset:Asset)=>void;onIcon?:(asset:Asset)=>void};
type ListProps=AssetActions&{assets:Asset[];book:Book;base:string;hidden:boolean};
export function AssetLedgerTable({assets,book,base,hidden,onEdit,onUpdate,onIcon}:ListProps){
 const numeric=(value:number)=>hidden?'••••••':amountText(value);
 const financials=new Map(assetFinancialRows(book).map(row=>[row.assetId,row]));
 return <Table className="asset-table"><TableHeader><TableRow>
  <TableHead>名称 / 代码</TableHead><TableHead>分类 / 平台</TableHead><TableHead className="currency-column">币种</TableHead><TableHead className="numeric">净投入</TableHead><TableHead className="numeric">市值</TableHead><TableHead className="numeric">收益</TableHead><TableHead className="numeric">折合 {base}</TableHead><TableHead>更新日期</TableHead>{onUpdate&&<TableHead>操作</TableHead>}
 </TableRow></TableHeader><TableBody>{assets.map(asset=><TableRow key={asset.id} className="currency-themed" style={currencyStyle(asset.currency)}>
  <TableCell><div className="asset-name"><AssetIcon asset={asset} onClick={onIcon?()=>onIcon(asset):undefined}/>{onEdit?<button type="button" className="asset-label" aria-label={`编辑${asset.name}资产信息`} onClick={()=>onEdit(asset)}><strong>{asset.name}</strong><small className="asset-code">{asset.code||'—'}</small></button>:<span className="asset-label"><strong>{asset.name}</strong><small className="asset-code">{asset.code||'—'}</small></span>}</div></TableCell>
  <TableCell><span className="tag">{assetClassification(asset)}</span><small className="table-sub">{asset.platform}</small></TableCell>
  <TableCell className="currency-column"><span className="currency-code">{asset.currency}</span></TableCell>
  <TableCell className="numeric"><strong>{financials.get(asset.id)?.netInput!=null?numeric(financials.get(asset.id)!.netInput!):'—'}</strong></TableCell>
  <TableCell className="numeric"><strong>{numeric(asset.value)}</strong></TableCell>
  <TableCell className={`numeric ${financials.get(asset.id)?.gain!=null?(financials.get(asset.id)!.gain!>=0?'positive':'negative'):''}`}>{financials.get(asset.id)?.gain!=null?numeric(financials.get(asset.id)!.gain!):'—'}</TableCell>
  <TableCell className="numeric converted-value">{numeric(convert(asset.value,asset.currency,base,book.rates))}</TableCell>
  <TableCell className="date-cell">{asset.date}</TableCell>{onUpdate&&<TableCell><div className="table-actions"><button onClick={()=>onUpdate(asset)}>更新</button></div></TableCell>}
 </TableRow>)}</TableBody></Table>;
}

function GroupSummaryTable({assets,book,base,kind,hidden}:ListProps&{kind:'currency'|'platform'}){
 const rows=assetGroupSummaries(book,base,kind,assets),summary=assetSummary(assets,base,book.rates);
 const currencies=Object.keys(summary.native).sort((a,b)=>a==='CNY'?-1:b==='CNY'?1:a.localeCompare(b));
 const numeric=(value:number)=>hidden?'••••••':amountText(value);
 const columns=kind==='currency'?1:currencies.length;
 return <section className="panel group-summary-panel"><div className="panel-heading"><h2>{kind==='currency'?'币种汇总':'平台汇总'}</h2><span className="muted">{base}</span></div>
  <Table className="asset-table group-summary-table"><TableHeader><TableRow><TableHead>{kind==='currency'?'币种':'平台'}</TableHead>
   {kind==='currency'?<TableHead className="numeric">原币金额</TableHead>:currencies.map(currency=><TableHead className="numeric" key={currency}>{currency}</TableHead>)}
   <TableHead className="numeric">折合 {base}</TableHead><TableHead className="numeric">占比</TableHead><TableHead className="numeric">资产数</TableHead>
  </TableRow></TableHeader><TableBody>{rows.map(row=><TableRow key={row.name} className={kind==='currency'?'currency-themed':undefined} style={kind==='currency'?currencyStyle(row.name):undefined}>
   <TableCell>{kind==='currency'?<div className="summary-currency-label"><span className="currency-code">{row.name}</span><span>{currencyNames(book)[row.name]??row.name}</span></div>:<strong>{row.name}</strong>}</TableCell>
   {kind==='currency'?<TableCell className="numeric">{numeric(row.native[row.name]??0)}</TableCell>:currencies.map(currency=><TableCell className="numeric" key={currency}>{row.native[currency]!==undefined?numeric(row.native[currency]):'—'}</TableCell>)}
   <TableCell className="numeric"><strong>{numeric(row.value)}</strong></TableCell><TableCell className="numeric">{hidden?'••••':`${summary.value?(row.value/summary.value*100).toFixed(1):'0.0'}%`}</TableCell><TableCell className="numeric">{row.count}</TableCell>
  </TableRow>)}{rows.length>0?<TableRow className="summary-total-row"><TableCell><strong>总计</strong></TableCell>
   {kind==='currency'?<TableCell className="numeric">—</TableCell>:currencies.map(currency=><TableCell className="numeric" key={currency}>{numeric(summary.native[currency])}</TableCell>)}
   <TableCell className="numeric"><strong>{numeric(summary.value)}</strong></TableCell><TableCell className="numeric">{hidden?'••••':summary.value?'100.0%':'0.0%'}</TableCell><TableCell className="numeric">{summary.count}</TableCell>
  </TableRow>:<TableRow><TableCell colSpan={columns+4} className="summary-empty">暂无匹配资产</TableCell></TableRow>}</TableBody></Table>
 </section>;
}

export function GroupedAssetDetails({assets,book,base,hidden,onEdit,onUpdate,onIcon,kind}:ListProps&{kind:'platform'|'classification'|'currency'}){
 const grouped=groups(assets,kind,base,book.rates);
 return <div className="platform-asset-details">{grouped.map(group=><section className="platform-detail-group" key={group.name}>
  <header className="asset-group-heading"><div className="asset-group-title">{kind==='platform'?<AssetIcon asset={{name:group.name,platform:group.name,category:'现金'}}/>:<span className="aggregate-icon"><Layers size={20}/></span>}<div><h2>{group.name}</h2><small>{group.count} 笔资产</small></div></div><div className="asset-group-total"><strong>{hidden?'••••••':money(group.value,base)}</strong><small>折合 {base}</small></div></header>
  <AssetLedgerTable assets={assets.filter(asset=>(kind==='classification'?accountClassification(asset):asset[kind])===group.name)} book={book} base={base} hidden={hidden} onEdit={onEdit} onUpdate={onUpdate} onIcon={onIcon}/>
 </section>)}{!grouped.length&&<div className="empty-inline"><Wallet size={25}/><p>没有匹配的资产</p></div>}</div>;
}

export function GroupedAssetView({book,base,kind,hidden}:{book:Book;base:string;kind:'currency'|'platform';hidden:boolean}){
 const [query,setQuery]=useState(''),[category,setCategory]=useState('all');
 const assets=book.assets.filter(asset=>(category==='all'||accountClassification(asset)===category)&&`${asset.name} ${asset.code??''} ${asset.platform} ${asset.currency}`.toLowerCase().includes(query.toLowerCase()));
 const grouped=groups(assets,kind,base,book.rates),numeric=(value:number)=>hidden?'••••••':amountText(value);
 return <div className="grouped-asset-page">
  <section className="panel grouped-page-filter"><div className="asset-toolbar"><div className="search-field"><Search size={16}/><input aria-label="搜索分组资产" placeholder="搜索名称、代码、平台或币种" value={query} onChange={event=>setQuery(event.target.value)}/></div><Choice label="筛选分类" value={category} onChange={setCategory} options={{all:'全部分类',...Object.fromEntries(classificationOptions(book).map(value=>[value,value]))}}/></div></section>
  <GroupSummaryTable assets={assets} book={book} base={base} kind={kind} hidden={hidden}/>
  {grouped.map(group=>{
   const rows=assets.filter(asset=>asset[kind]===group.name).sort((a,b)=>convert(b.value,b.currency,base,book.rates)-convert(a.value,a.currency,base,book.rates));
   const currencies=groups(rows,'currency',base,book.rates);
   return <section key={group.name} className="panel asset-group-panel">
    <header className="asset-group-heading"><div className="asset-group-title">{kind==='currency'?<span className="currency-themed" style={currencyStyle(group.name)}><span className="currency-code">{group.name}</span></span>:<AssetIcon asset={{name:group.name,platform:group.name,category:'现金'}}/>}<div><h2>{kind==='currency'?currencyNames(book)[group.name]:group.name}</h2><small>{group.count} 笔资产</small></div></div>
     <div className="asset-group-total"><strong>{numeric(kind==='currency'?group.native:group.value)}</strong><small>{kind==='currency'?`折合 ${base} ${numeric(group.value)}`:`折合 ${base}`}</small></div>
    </header>
    {kind==='platform'&&<div className="platform-currency-totals">{currencies.map(currency=><span key={currency.name} className="currency-themed" style={currencyStyle(currency.name)}><span className="currency-code">{currency.name}</span><b>{numeric(currency.native)}</b></span>)}</div>}
    <AssetLedgerTable assets={rows} book={book} base={base} hidden={hidden}/>
   </section>;
  })}
  {!grouped.length&&<div className="panel empty-inline"><Wallet size={25}/><p>暂无匹配资产</p></div>}
 </div>;
}
