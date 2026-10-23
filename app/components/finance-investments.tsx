'use client';
import {ChartEndpoint,chartTooltipStyle,chartTooltipLabelStyle} from './finance-chart-style';
import {currencyStyle} from '@/lib/currency-theme';
import {useState} from 'react';
import {TrendingUp,Search} from 'lucide-react';
import {AreaChart,Area,XAxis,YAxis,Tooltip,ResponsiveContainer,ReferenceLine} from 'recharts';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell} from '@/components/ui/table';
import {type Book,type Asset,convert} from '@/lib/finance';
import {gainReturn,investmentReturn,type GainSnapshot} from '@/lib/investing';
import {accountClassification,capitalAccounts} from '@/lib/capital-accounts';
import {money,amountText,chartBounds} from './finance-dashboard';
import {chartAmount,chartPercent,chartTime,chartDate,chartMonth,chartEndpointTicks} from '@/lib/chart-format';
import {ratesAt} from '@/lib/exchange';
export default function InvestmentWorkspace({book,base,hidden,onIcon}:{book:Book;base:string;hidden:boolean;onIcon:(asset:Asset)=>void}){
 const [query,setQuery]=useState('');
 const rows=capitalAccounts(book).map(account=>{
  const assets=book.assets.filter(asset=>asset.platform===account.platform&&accountClassification(asset)===account.classification&&asset.currency===account.currency);
  const cash=assets.filter(asset=>asset.category==='现金').reduce((sum,asset)=>sum+asset.value,0);
  const holdings=assets.filter(asset=>asset.category!=='现金').reduce((sum,asset)=>sum+asset.value,0);
  return {...account,cash,holdings,value:cash+holdings,gainCny:(cash+holdings)*(book.rates[account.currency]??1)-account.costCny};
 });
 const sum=(field:'gainCny'|'costCny'|'cash')=>rows.reduce((n,a)=>n+(field==='cash'?a.cash*(book.rates[a.currency]??1):a[field]),0);
 const numeric=(value:number)=>hidden?'••••':amountText(value);
 const fmt=(value:number,c='CNY')=>hidden?'••••':money(value,c);

 const shown=rows.filter(a=>`${a.platform} ${a.classification} ${a.currency}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.gainCny-a.gainCny);
 return <div className="investment-workspace">
 <div className="investment-stats"><section className="main currency-themed" style={currencyStyle('CNY')}><small>账户收益 · CNY</small><strong>{rows.length?fmt(sum('gainCny')):'—'}</strong></section><section><small>投入成本 · CNY</small><strong>{rows.length?fmt(sum('costCny')):'—'}</strong></section><section><small>账户现金 · CNY</small><strong>{rows.length?fmt(sum('cash')):'—'}</strong></section></div>

 <section className="panel earnings-list"><div className="panel-heading"><h2>账户收益 <span className="count">{shown.length}</span></h2><div className="search-field"><Search size={16}/><input aria-label="搜索账户" placeholder="搜索平台、分类或币种" value={query} onChange={e=>setQuery(e.target.value)}/></div></div>
 <Table className="asset-table earnings-table"><TableHeader><TableRow><TableHead>平台</TableHead><TableHead>分类</TableHead><TableHead className="currency-column">币种</TableHead><TableHead className="numeric">投入成本</TableHead><TableHead className="numeric">现金</TableHead><TableHead className="numeric">持仓市值</TableHead><TableHead className="numeric">账户总值</TableHead><TableHead className="numeric">收益 · CNY</TableHead></TableRow></TableHeader>
 <TableBody>{shown.map(row=><TableRow key={row.key} className="currency-themed" style={currencyStyle(row.currency)}><TableCell><strong>{row.platform}</strong></TableCell><TableCell><span className="tag">{row.classification}</span></TableCell><TableCell className="currency-column"><span className="currency-code">{row.currency}</span></TableCell><TableCell className="numeric">{numeric(row.cost)}</TableCell><TableCell className="numeric">{numeric(row.cash)}</TableCell><TableCell className="numeric">{numeric(row.holdings)}</TableCell><TableCell className="numeric">{numeric(row.value)}</TableCell><TableCell className={`numeric ${row.gainCny>=0?'positive':'negative'}`}><strong>{numeric(row.gainCny)}</strong></TableCell></TableRow>)}</TableBody></Table>{!shown.length&&<div className="empty-inline">暂无账户数据</div>}</section>
 </div>;
}

const curves={total:{title:'收益率',color:'#7e8fad'},股票:{title:'股市收益率曲线',color:'#6b9bb4'},黄金:{title:'黄金收益率曲线',color:'#c4a063'},虚拟币:{title:'虚拟币收益率曲线',color:'#9b86b8'}};
export function IncomeCurve({book,history,hidden,kind}:{book:Book;history:GainSnapshot[];hidden:boolean;kind:keyof typeof curves}){
 const curve=curves[kind],percentage=true;
 const trend=history.map(snapshot=>{
  const totals=kind==='total'?snapshot.totals:snapshot.categories?.[kind];
  const locked=kind==='total'?snapshot.cnyInvestmentTotal:snapshot.cnyCategories?.[kind];
  return {date:snapshot.date,time:chartTime(snapshot.date),gain:kind==='total'?investmentReturn(snapshot):gainReturn(snapshot,kind)};
 });
 const values=trend.flatMap(point=>point.gain===null?[]:[point.gain]),available=values.length>0,gradient='income-gradient-'+kind;
 const first=trend.findIndex(point=>point.gain!==null),last=trend.findLastIndex(point=>point.gain!==null);
 return <section className="panel investment-curve" style={{'--curve-color':curve.color} as React.CSSProperties}><div className="panel-heading"><h2>{curve.title}</h2><span className="muted">{percentage?'%':'CNY'}</span></div><div className="monthly-chart">
   {available&&!hidden?<ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width:300,height:240}}><AreaChart data={trend} margin={{top:16,left:0,right:18,bottom:10}}>
    <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={curve.color} stopOpacity={.22}/><stop offset="100%" stopColor={curve.color} stopOpacity={.015}/></linearGradient></defs>
    {chartEndpointTicks(values).map(value=><ReferenceLine className="chart-endpoint-guide" key={'y-'+value} y={value} zIndex={50} stroke="#d5dde8" strokeWidth={1} strokeDasharray="3 6"/>)}
    <XAxis height={42} tickMargin={16} padding={{left:10,right:8}} dataKey="time" type="number" scale="time" domain={['dataMin','dataMax']} ticks={chartEndpointTicks(trend.map(point=>point.gain===null?null:point.time))} tickFormatter={chartMonth} axisLine={false} tickLine={false} interval={0} tick={{fontSize:11,fill:'#737a85'}}/><YAxis width={72} tickMargin={14} axisLine={false} tickLine={false} tick={{fontSize:11,fill:'#737a85'}} tickFormatter={percentage?chartPercent:chartAmount} domain={chartBounds(values)} ticks={chartEndpointTicks(values)} interval={0}/>
    <Tooltip cursor={false} contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} labelFormatter={value=>chartDate(Number(value))} formatter={value=>percentage?`${amountText(Number(value))}%`:money(Number(value),'CNY')}/><Area isAnimationActive={false} dataKey="gain" name={curve.title.replace('曲线','')} type="monotone" stroke={curve.color} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" animationDuration={650} fill={`url(#${gradient})`} connectNulls={false} dot={({cx,cy,index})=>index===first||index===last?<ChartEndpoint key={index} cx={cx} cy={cy} color={curve.color}/>:<g key={index}/>} activeDot={{r:5,fill:curve.color,stroke:'white',strokeWidth:2.5}}/>
   </AreaChart></ResponsiveContainer>:<div className="empty-inline"><TrendingUp size={26}/><p>{hidden?'金额已隐藏':'暂无收益记录'}</p></div>}
 </div></section>;
}
