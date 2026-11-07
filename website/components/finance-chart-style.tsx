export const chartTooltipStyle={border:'1px solid #e0e4e9',borderRadius:8,background:'#fff',padding:'8px 12px',fontSize:13,lineHeight:1.6,maxWidth:'calc(100vw - 56px)',whiteSpace:'normal'};
export const chartTooltipLabelStyle={color:'#656e7b',fontSize:12,marginBottom:4};

export function ChartEndpoint({cx,cy,color}:{cx?:number;cy?:number;color:string}){
 if(cx==null||cy==null)return null;
 return <circle className="chart-endpoint" pointerEvents="none" cx={cx} cy={cy} r={3} fill="white" stroke={color} strokeWidth={1.5}/>;
}
