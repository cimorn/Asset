'use client';
import {useState} from 'react';
import {Search,History} from 'lucide-react';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell} from '@/components/ui/table';
import {type Book,currencyNames,recordEntries,recordClassification} from '@/lib/finance';
import {currencyStyle} from '@/lib/currency-theme';
import {Choice} from './finance-forms';
import {amountText} from './finance-dashboard';
import AssetIcon from './finance-asset-icon';

export default function RecordView({book,hidden,onEdit}:{book:Book;hidden:boolean;onEdit:(id:string)=>void}){
 const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[month,setMonth]=useState('all'),[currency,setCurrency]=useState('all'),[page,setPage]=useState(1);
 const entries=recordEntries(book),rows=entries.filter(({record,label})=>(kind==='all'||label===kind)&&(month==='all'||record.date.startsWith(month))&&(currency==='all'||record.currency===currency)&&`${record.name} ${record.platform} ${recordClassification(book,record)} ${record.code??book.assets.find(asset=>asset.id===record.assetId)?.code??''}`.toLowerCase().includes(query.toLowerCase()));
 const pages=Math.max(1,Math.ceil(rows.length/20)),currentPage=Math.min(page,pages),numeric=(value:number|null)=>value===null?'—':hidden?'••••••':amountText(value);
 return <section className="panel records-panel records-readable">
  <div className="panel-heading"><h2>流水明细 <span className="count">{book.records.length}</span></h2></div>
  <div className="asset-toolbar"><div className="search-field"><Search size={15}/><input aria-label="搜索流水" placeholder="搜索名称、代码或平台" value={query} onChange={event=>{setQuery(event.target.value);setPage(1);}}/></div><Choice label="操作类型" value={kind} onChange={value=>{setKind(value);setPage(1);}} options={{all:'全部操作',...Object.fromEntries([...new Set(entries.map(item=>item.label))].map(label=>[label,label]))}}/><Choice label="记录月份" value={month} onChange={value=>{setMonth(value);setPage(1);}} options={{all:'全部月份',...Object.fromEntries([...new Set(book.records.map(record=>record.date.slice(0,7)))].sort().reverse().map(value=>[value,value]))}}/><Choice label="流水币种" value={currency} onChange={value=>{setCurrency(value);setPage(1);}} options={{all:'全部币种',...Object.fromEntries(Object.keys(currencyNames(book)).map(code=>[code,code]))}}/></div>
  <Table className="asset-table records-table"><TableHeader><TableRow><TableHead>日期</TableHead><TableHead>名称 / 平台</TableHead><TableHead>分类</TableHead><TableHead>操作</TableHead><TableHead className="currency-column">币种</TableHead><TableHead className="numeric">金额</TableHead><TableHead className="numeric">市值</TableHead><TableHead className="numeric">汇率</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>{rows.slice((currentPage-1)*20,currentPage*20).map(({record,label,operationAmount,value,exchangeRate})=>{
   const asset=book.assets.find(item=>item.id===record.assetId);
   return <TableRow key={record.id} className="currency-themed" style={currencyStyle(record.currency)}>
    <TableCell className="date-cell">{record.date}</TableCell><TableCell><div className="asset-name"><AssetIcon asset={asset??{name:record.name,platform:record.platform}}/><span><strong>{record.name}</strong><small className="table-sub">{[record.code??asset?.code,record.platform].filter(Boolean).join(' · ')}</small></span></div></TableCell><TableCell><span className="tag">{recordClassification(book,record)}</span></TableCell><TableCell><span className="record-kind neutral">{record.transferId?'资金转移 · '+label:label}</span>{record.classificationChange&&<small className="table-sub">{record.previousClassification} → {record.classification}</small>}{record.counterpartyId&&<small className="table-sub">{record.transferLeg==='out'?'转至':'来自'} {book.assets.find(item=>item.id===record.counterpartyId)?.name??'其他账户'}</small>}{record.remainingMode&&<small className="table-sub">{record.remainingMode}</small>}</TableCell><TableCell className="currency-column"><span className="currency-code">{record.currency}</span></TableCell><TableCell className="numeric"><strong>{numeric(operationAmount)}</strong></TableCell><TableCell className="numeric">{numeric(value)}</TableCell><TableCell className="numeric">{hidden?'••••':exchangeRate}</TableCell><TableCell><button className="text-button" aria-label={'编辑'+record.name+' '+record.date+'流水'} onClick={()=>onEdit(record.id)}>编辑</button></TableCell>
   </TableRow>;
  })}</TableBody></Table>
  {!rows.length&&<div className="empty-inline"><History size={25}/><p>暂无匹配流水</p></div>}<div className="table-footer"><span>共 {rows.length} 条 · 第 {currentPage} / {pages} 页</span><div><button className="text-button" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</button><button className="text-button" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>下一页</button></div></div>
 </section>;
}
