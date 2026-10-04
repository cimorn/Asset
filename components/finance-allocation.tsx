'use client';
import {useId} from 'react';
import {colors,groups,type Book} from '@/lib/finance';

const cx=180,cy=180,radius=164;
const point=(angle:number,distance:number)=>({x:cx+Math.cos(angle)*distance,y:cy+Math.sin(angle)*distance});
const palette:Record<string,string>={基金:'#b7c4dc',股票:'#9cb8d7',债券:'#a2c5c5',现金:'#accbb9',黄金:'#d7bf95',其他:'#c3cbd8'};

export default function AllocationPie({book,hidden}:{book:Book;hidden:boolean}){
 const chartId='allocation-'+useId().replace(/[^a-zA-Z0-9_-]/g,'');
 // Each asset is converted to CNY before category totals or shares are calculated.
 const entries=groups(book.assets,'category','CNY',book.rates).filter(item=>item.value>0),sum=entries.reduce((value,item)=>value+item.value,0);
 const amount=(value:number)=>hidden?'••••••':value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
 if(!sum)return <div className="allocation-pie empty-inline">暂无资产配置</div>;
 let angle=-Math.PI/2;
 const slices=entries.map((item,index)=>{
  const share=item.value/sum,start=angle,end=start+share*Math.PI*2,mid=(start+end)/2;
  angle=end;
  const from=point(start,radius),to=point(end,radius);
  return {...item,share,mid,percentage:`${(share*100).toFixed(1)}%`,fill:palette[item.name]??colors['其他'],gradient:chartId+'-'+index,path:`M ${cx} ${cy} L ${from.x} ${from.y} A ${radius} ${radius} 0 ${share>.5?1:0} 1 ${to.x} ${to.y} Z`};
 });
 return <div className="allocation-pie"><svg viewBox="0 0 360 360" role="img" aria-label={`资产配置，按人民币折算：${slices.map(slice=>`${slice.name} ${slice.percentage}`).join('，')}`}>
  <defs>{slices.map(slice=><linearGradient key={slice.name} id={slice.gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={slice.fill} stopOpacity=".86"/><stop offset="100%" stopColor={slice.fill}/></linearGradient>)}</defs>
  <g className="allocation-sectors">{slices.map(slice=><g key={slice.name} className="allocation-slice" tabIndex={0} aria-label={`${slice.name} ${slice.percentage}`}>
   <title>{`${slice.name} · ${slice.percentage} · CNY ${amount(slice.value)}`}</title>
   {slice.share>=1-1e-10?<circle cx={cx} cy={cy} r={radius} fill={`url(#${slice.gradient})`}/>:<path d={slice.path} fill={`url(#${slice.gradient})`} stroke="#fff" strokeWidth="2.4" strokeLinejoin="round"/>}
  </g>)}</g>
  {slices.map(slice=>{
   if(slice.share>=.065){
    const compact=slice.share<.13,location=slice.share>=1-1e-10?{x:cx,y:cy}:point(slice.mid,radius*(compact?.7:.56));
    return <text key={slice.name} x={location.x} y={location.y-7} textAnchor="middle" className="allocation-label inside" style={{fontSize:compact?12.5:14}}><tspan x={location.x}>{slice.name}</tspan><tspan x={location.x} dy={compact?20:23} className="allocation-percent" style={{fontSize:compact?16:18}}>{slice.percentage}</tspan></text>;
   }
   // Fit a single radial line inside narrow sectors, keeping the true slice size.
   const label=slice.name+' '+slice.percentage,units=[...label].reduce((width,char)=>width+(/[^\x00-\xff]/.test(char)?1:char===' '?.3:.58),0);
   const fontSize=Math.max(5,Math.min(12,(radius-26)/(units+1/(2*Math.tan(slice.share*Math.PI))))),width=units*fontSize;
   const location=point(slice.mid,radius-14-width/2),rotation=slice.mid*180/Math.PI+(Math.cos(slice.mid)<0?180:0);
   return <text key={slice.name} x={location.x} y={location.y} transform={`rotate(${rotation} ${location.x} ${location.y})`} textAnchor="middle" dominantBaseline="middle" className="allocation-label inside compact" style={{fontSize}}>{label}</text>;
  })}
 </svg></div>;
}
