'use client';
import {ChartEndpoint,chartTooltipStyle,chartTooltipLabelStyle} from './finance-chart-style';
import {currencyStyle} from '@/lib/currency-theme';
import {useState} from 'react';
import {ratesAt} from '@/lib/exchange';
import {chartAmount,chartTime,chartDate,chartMonth,chartEndpointTicks} from '@/lib/chart-format';
import {portfolioPerformance,investmentOverview} from '@/lib/asset-statistics';
import {Eye,TrendingUp} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {AreaChart,Area,XAxis,YAxis,Tooltip,ResponsiveContainer,ReferenceLine} from 'recharts';
import {type Book,currencyNames,assetSummary,classificationSummaries,convert} from '@/lib/finance';

export function CurrencySelect({value,onChange,book}:{value:string;onChange:(s:string)=>void;book?:Book}){return <Select value={value} onValueChange={onChange}><SelectTrigger className="currency-picker currency-themed" style={currencyStyle(value)} aria-label="总览基准币种"><SelectValue/></SelectTrigger><SelectContent>{Object.keys(currencyNames(book)).map(c=><SelectItem key={c} value={c}><span className="currency-option" style={currencyStyle(c)}>{c}</span></SelectItem>)}</SelectContent></Select>;}
export function amountText(n:number){return new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n);}
export function money(n:number,c:string){return new Intl.NumberFormat('zh-CN',{style:'currency',currency:c,maximumFractionDigits:2}).format(n);}
export function chartBounds(values:number[]):[number,number]{
 const min=Math.min(...values),max=Math.max(...values);
 const padding=max>min?Math.max((max-min)*.15,Number.EPSILON):Math.max(Math.abs(max)*.04,1);
 return [min-padding,max+padding];
}

export default function PortfolioSummary({book,base,hidden}:{book:Book;base:string;hidden:boolean}){
 const {summary,classified,performance:investment}=investmentOverview(book,base),performance=portfolioPerformance(book,base);
 const all=assetSummary(book.assets,base,book.rates);
 const fmt=(n:number)=>hidden?'••••••':amountText(n);
 return <div className="classification-summary-grid">
  <section className="wealth-card currency-themed" style={currencyStyle(base)}><div className="card-top"><span>总资产 <Eye size={15}/></span><span className="currency-code">{base}</span></div><div className="wealth-value">{fmt(all.value)}</div><SummaryPerformance value={performance.total} hidden={hidden}/></section>
  <section className="wealth-card currency-themed" style={currencyStyle(base)}><div className="card-top"><span>总投资 <Eye size={15}/></span><span className="currency-code">{base}</span></div><div className="wealth-value">{fmt(summary.value)}</div><SummaryPerformance value={investment} hidden={hidden}/></section>
  {classified.map(group=><section className="stat-card classification-stat" key={group.name} data-classification={group.name}><div className="stat-label"><span>{group.name}</span><span className="classification-share">{`${group.share.toFixed(1)}%`}</span></div><strong>{fmt(group.value)}</strong><SummaryPerformance value={performance.groups[group.name]} hidden={hidden}/></section>)}
 </div>;
}

function SummaryPerformance({value,hidden}:{value?:{cost:number|null;gain:number|null;returnRate:number|null};hidden:boolean}){
 const fmt=(n:number|null|undefined)=>hidden?'••••':n==null?'—':amountText(n);
 return <dl className="summary-performance"><div><dt>成本</dt><dd>{fmt(value?.cost)}</dd></div><div><dt>收益</dt><dd className={!hidden&&value?.gain?value.gain>0?'positive':'negative':undefined}>{fmt(value?.gain)}</dd></div><div title="账户收益 ÷ 账户净投入；账户内买卖只改变现金与持仓，非年化收益率"><dt>收益率</dt><dd className={!hidden&&value?.returnRate?value.returnRate>0?'positive':'negative':undefined}>{hidden?'••••':value?.returnRate==null?'—':`${amountText(value.returnRate)}%`}</dd></div></dl>;
}

export function AssetTrend({book,base,hidden}:{book:Book;base:string;hidden:boolean}){
 const [period,setPeriod]=useState('all');
 const latest=book.snapshots.at(-1)?.date??book.statisticsStart??'2026-09-01';
 const cutoff=new Date(`${latest}T00:00:00Z`);cutoff.setUTCMonth(cutoff.getUTCMonth()-(period==='1m'?1:6));
 const trend=book.snapshots.filter(s=>(!book.statisticsStart||s.date>=book.statisticsStart)&&(period==='all'||s.date>=cutoff.toISOString().slice(0,10))).map(s=>({date:s.date,time:chartTime(s.date),value:Object.entries(s.investmentTotals??{}).reduce((n,[c,v])=>n+convert(v,c,base,s.rates??ratesAt(book,s.date)),0)}));
 return <section className="panel trend-panel" style={{'--curve-color':'#6e8fb7'} as React.CSSProperties}><div className="panel-heading"><h2>投资资金</h2><Tabs value={period} onValueChange={setPeriod}><TabsList><TabsTrigger value="1m">1个月</TabsTrigger><TabsTrigger value="6m">6个月</TabsTrigger><TabsTrigger value="all">全部</TabsTrigger></TabsList></Tabs></div><div className="trend-chart">
  {trend.length>0&&!hidden?<ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width:300,height:280}}><AreaChart data={trend} margin={{top:15,right:18,left:0,bottom:10}}>
   <defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6e8fb7" stopOpacity={.22}/><stop offset="100%" stopColor="#6e8fb7" stopOpacity={.015}/></linearGradient></defs>
   {chartEndpointTicks(trend.map(point=>point.value)).map(value=><ReferenceLine className="chart-endpoint-guide" key={'y-'+value} y={value} zIndex={50} stroke="#d5dde8" strokeWidth={1} strokeDasharray="3 6"/>)}
   <XAxis height={42} tickMargin={16} padding={{left:10,right:8}} dataKey="time" type="number" scale="time" domain={['dataMin','dataMax']} ticks={chartEndpointTicks(trend.map(point=>point.time))} tickFormatter={chartMonth} axisLine={false} tickLine={false} tick={{fill:'#66758c',fontSize:11}} interval={0}/><YAxis width={72} tickMargin={14} axisLine={false} tickLine={false} tick={{fill:'#66758c',fontSize:11}} tickFormatter={chartAmount} domain={chartBounds(trend.map(point=>point.value))} ticks={chartEndpointTicks(trend.map(point=>point.value))} interval={0}/><Tooltip cursor={false} contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} labelFormatter={value=>chartDate(Number(value))} formatter={v=>hidden?'••••••':money(Number(v),base)}/><Area isAnimationActive={false} type="monotone" dataKey="value" name="总投资" stroke="#6e8fb7" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" animationDuration={650} fill="url(#areaFill)" dot={({cx,cy,index})=>index===0||index===trend.length-1?<ChartEndpoint key={index} cx={cx} cy={cy} color="#6e8fb7"/>:<g key={index}/>} activeDot={{r:5,fill:'#6e8fb7',stroke:'white',strokeWidth:2.5}}/>
  </AreaChart></ResponsiveContainer>:<div className="empty-inline"><TrendingUp size={26}/><p>{hidden?'金额已隐藏':'暂无趋势数据'}</p></div>}
 </div></section>;
}
