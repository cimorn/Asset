'use client';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell} from '@/components/ui/table';
import {type AssetUpdateHistory,type UpdateStatus} from '@/lib/asset-update-dates';
import {Choice} from './finance-forms';
import '@/app/update-dates.css';

export default function UpdateDates({history,date,status,onSelect}:{history:AssetUpdateHistory;date:string;status:UpdateStatus;onSelect:(date:string,status:UpdateStatus)=>void}){
 const selected=history.rows.find(row=>row.date===date);
 return <section className="panel update-dates-panel" aria-label="更新日期汇总">
  <div className="update-dates-heading"><div><h2>更新日期汇总</h2><p>按当天流水统计，含买入、卖出、更新和剩余。同一资产每天计一次。</p></div><span className="update-dates-caption">全部资产</span></div>
  {history.rows.length>0?<>
   <div className="update-dates-scroll"><Table className="update-dates-table"><TableHeader><TableRow><TableHead>更新日期</TableHead><TableHead className="numeric">当日已有资产</TableHead><TableHead className="numeric">已更新</TableHead><TableHead className="numeric">未更新</TableHead></TableRow></TableHeader><TableBody>
    {history.rows.map(row=><TableRow key={row.date} data-selected={row.date===date}>
     <TableCell><button type="button" className="update-date-link" aria-label={`核对 ${row.date}`} aria-pressed={row.date===date} onClick={()=>onSelect(row.date,status)}>{row.date}</button>{row.date===history.dates[0]&&<span className="update-latest">最近</span>}</TableCell>
     <TableCell className="numeric">{row.total} 笔</TableCell>
     <TableCell className="numeric"><button type="button" className="update-count updated" aria-label={`查看 ${row.date} 已更新资产`} aria-pressed={row.date===date&&status==='updated'} onClick={()=>onSelect(row.date,'updated')}>{row.updated} 笔</button></TableCell>
     <TableCell className="numeric"><button type="button" className="update-count pending" aria-label={`查看 ${row.date} 未更新资产`} aria-pressed={row.date===date&&status==='pending'} onClick={()=>onSelect(row.date,'pending')}>{row.pending} 笔</button></TableCell>
    </TableRow>)}
   </TableBody></Table></div>
   <div className="update-date-filters"><label>核对日期<Choice label="核对更新日期" value={date} onChange={value=>onSelect(value,status)} options={Object.fromEntries(history.dates.map(value=>[value,value]))}/></label><label>更新状态<Choice label="筛选更新状态" value={status} onChange={value=>onSelect(date,value as UpdateStatus)} options={{all:'全部资产',pending:'未更新',updated:'已更新'}}/></label><p role="status">{status==='all'?'下方显示全部资产':`${date} · ${status==='pending'?'未更新':'已更新'} ${status==='pending'?selected?.pending??0:selected?.updated??0} 笔`}</p></div>
  </>:<div className="update-dates-empty">有资产流水后，这里会显示更新日期。</div>}
 </section>;
}
