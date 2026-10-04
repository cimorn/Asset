const axisNumber=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2});
export function chartAmount(value:number){return `${new Intl.NumberFormat('zh-CN',{maximumFractionDigits:Math.abs(value)>=1000?2:4}).format(value/10000)}W`;}
export function chartPercent(value:number){return `${axisNumber.format(value)}%`;}
export function chartTime(date:string){return Date.parse(`${date}T00:00:00Z`);}
export function chartDate(value:number){return new Date(value).toISOString().slice(0,10);}
export function chartMonth(value:number){return chartDate(value).slice(2,7).replace('-','');}
/** Use the values at the two visible ends, even when an interior point is an extremum. */
export function chartEndpointTicks(values:(number|null|undefined)[]){
 const known=values.filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
 return known.length?[...new Set([known[0],known.at(-1)!])].sort((a,b)=>a-b):[];
}
/** Month ticks use elapsed time; every irregular update remains a separate point. */
export function chartMonthTicks(dates:string[]){
 if(!dates.length)return [];
 const times=dates.map(chartTime),first=Math.min(...times),last=Math.max(...times),cursor=new Date(first),ticks=[first];
 cursor.setUTCDate(1);cursor.setUTCMonth(cursor.getUTCMonth()+1);
 while(cursor.getTime()<=last){ticks.push(cursor.getTime());cursor.setUTCMonth(cursor.getUTCMonth()+1);}
 return ticks;
}
