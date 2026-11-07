'use client';
import {ChartEndpoint,chartTooltipStyle,chartTooltipLabelStyle} from './finance-chart-style';
import {currencyStyle} from '@/lib/currency-theme';
import {useState} from 'react';
import {ratesAt} from '@/lib/exchange';
import {chartAmount,chartTime,chartDate,chartMonth,chartEndpointTicks} from '@/lib/chart-format';
import {portfolioPerformance,investmentOverview} from '@/lib/asset-statistics';
import {TrendingUp} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {AreaChart,Area,XAxis,YAxis,Tooltip,ResponsiveContainer,ReferenceLine} from 'recharts';
import {type Book,currencyNames,assetSummary,convert} from '@/lib/finance';

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

 return <section className="classification-summary-grid" aria-label="资产摘要">
  <PortfolioTable label="资产与投资" rowHeading="项目" hidden={hidden} rows={[
   {name:'总资产',value:all.value,performance:performance.total},
   {name:'总投资',value:summary.value,performance:investment},
  ]}/>
  <PortfolioTable label="资产分类" rowHeading="分类" hidden={hidden} rows={classified.map(group=>({
   name:group.name,value:group.value,share:group.share,performance:performance.groups[group.name],
  }))}/>
 </section>;
}

type PortfolioTableRow={
 name:string;
 value:number;
 share?:number;
 performance?:ReturnType<typeof portfolioPerformance>['total'];
};

function PortfolioTable({label,rowHeading,rows,hidden}:{label:string;rowHeading:string;rows:PortfolioTableRow[];hidden:boolean}){
 const fmt=(n:number|null|undefined)=>hidden?'••••':n==null?'—':amountText(n);
 const gainClass=(n:number|null|undefined)=>!hidden&&n?(n>0?'positive':'negative'):undefined;
 return <section className="panel portfolio-table-frame" aria-label={label} tabIndex={0}>
  <table className="portfolio-table" aria-label={label}>
   <thead><tr>
    <th scope="col">{rowHeading}</th>
    <th scope="col">市值</th>
    <th scope="col">成本</th>
    <th scope="col">收益</th>
    <th scope="col" title="账户收益除以净投入。账户内买卖只改变现金与持仓。此收益率未年化。">收益率</th>
   </tr></thead>
   <tbody>
    {rows.map(({name,value,share,performance})=><tr key={name}>
     <th scope="row">{name}{share!==undefined&&<small className="portfolio-table-share">{hidden?'••••':`${share.toFixed(1)}%`}</small>}</th>
     <td className="portfolio-table-value">{hidden?'••••••':amountText(value)}</td>
     <td>{fmt(performance?.cost)}</td>
     <td className={gainClass(performance?.gain)}>{fmt(performance?.gain)}</td>
     <td className={gainClass(performance?.returnRate)}>{hidden?'••••':performance?.returnRate==null?'—':`${amountText(performance.returnRate)}%`}</td>
    </tr>)}
    {!rows.length&&<tr><td colSpan={5} className="portfolio-table-empty">录入资产后，这里会显示各分类的金额和占比。</td></tr>}
   </tbody>
  </table>
 </section>;
}

export function AssetTrend({book,base,hidden}:{book:Book;base:string;hidden:boolean}){
 const [period,setPeriod]=useState('all');
 const latest=book.snapshots.at(-1)?.date??book.statisticsStart??'2026-09-01';
 const cutoff=new Date(`${latest}T00:00:00Z`);cutoff.setUTCMonth(cutoff.getUTCMonth()-(period==='1m'?1:6));
 const trend=book.snapshots.filter(s=>(!book.statisticsStart||s.date>=book.statisticsStart)&&(period==='all'||s.date>=cutoff.toISOString().slice(0,10))).map(s=>({date:s.date,time:chartTime(s.date),value:Object.entries(s.investmentTotals??{}).reduce((n,[c,v])=>n+convert(v,c,base,s.rates??ratesAt(book,s.date)),0)}));
 return <section className="panel trend-panel"><div className="panel-heading"><div className="trend-title"><h2>投资资金</h2><span>{base}</span></div><Tabs value={period} onValueChange={setPeriod}><TabsList><TabsTrigger value="1m">1个月</TabsTrigger><TabsTrigger value="6m">6个月</TabsTrigger><TabsTrigger value="all">全部</TabsTrigger></TabsList></Tabs></div><div className="trend-chart">
  {trend.length>0&&!hidden?<ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width:300,height:280}}><AreaChart data={trend} margin={{top:15,right:18,left:0,bottom:10}}>
   {chartEndpointTicks(trend.map(point=>point.value)).map(value=><ReferenceLine className="chart-endpoint-guide" key={'y-'+value} y={value} zIndex={50} stroke="#d5dde8" strokeWidth={1} strokeDasharray="3 6"/>)}
   <XAxis height={42} tickMargin={16} padding={{left:10,right:8}} dataKey="time" type="number" scale="time" domain={['dataMin','dataMax']} ticks={chartEndpointTicks(trend.map(point=>point.time))} tickFormatter={chartMonth} axisLine={false} tickLine={false} tick={{fill:'#66758c',fontSize:11}} interval={0}/><YAxis width={72} tickMargin={14} axisLine={false} tickLine={false} tick={{fill:'#66758c',fontSize:11}} tickFormatter={chartAmount} domain={chartBounds(trend.map(point=>point.value))} ticks={chartEndpointTicks(trend.map(point=>point.value))} interval={0}/><Tooltip cursor={false} contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} labelFormatter={value=>chartDate(Number(value))} formatter={v=>hidden?'••••••':money(Number(v),base)}/><Area isAnimationActive={false} type="monotone" dataKey="value" name="总投资" stroke="#456b96" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="#456b96" fillOpacity={.08} dot={({cx,cy,index})=>index===0||index===trend.length-1?<ChartEndpoint key={index} cx={cx} cy={cy} color="#456b96"/>:<g key={index}/>} activeDot={{r:5,fill:'#456b96',stroke:'white',strokeWidth:2.5}}/>
  </AreaChart></ResponsiveContainer>:<div className="empty-inline"><TrendingUp size={26}/><p>{hidden?'金额已隐藏':'暂无趋势数据'}</p></div>}
 </div></section>;
}
